# Browser/manual workflow proof

Run: 2026-05-02-ai-video-idea-filter
Working title: Stop Letting AI Choose Your Video Strategy

## Server and browser setup

- Server command used: `./scripts/serve-local.sh`
- Server URL checked: `http://127.0.0.1:8010/api/package-engine/status`
- Browser method used: headless Chrome through Chrome DevTools Protocol because the built-in browser tool could not connect to its CDP endpoint in this session.
- Chrome command used: `google-chrome --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/vidtoolz-may2-chrome-9333 --disable-gpu --no-first-run --no-default-browser-check about:blank`
- Observation log: `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/browser-export-import-observations.json`

## URLs opened

- Package engine: `http://127.0.0.1:8010/package-engine.html?run=2026-05-02-ai-video-idea-filter`
- Episode Factory app: `http://127.0.0.1:8010/index.html`

## Browser/manual actions performed

1. Opened the package engine run URL.
2. Confirmed the app loaded and reported package candidates.
3. Confirmed workflow controls were present, including `Select winner`, `Download selected JSON`, `Download selected Markdown`, thumbnail candidate controls, and generation controls.
4. Clicked the first visible `Select winner` control.
5. Confirmed the selection summary changed to `Selected #1: Stop Letting AI Choose Your Video Strategy`.
6. Reloaded the package engine page to check persistence of the UI-selected winner.
7. Opened the Episode Factory app to verify export/import controls were visible.

## Observed UI state

- Package engine document title: `VIDTOOLZ Package Engine`
- Package engine load status: `Loaded 10 package candidates from package-candidates.json.`
- Candidate count shown: `10 shown / 10 total`
- Initial selected summary: `No winner selected`
- Initial selected-export controls: JSON disabled = `True`, Markdown disabled = `True`
- After selection summary: `Selected #1: Stop Letting AI Choose Your Video Strategy`
- After selection status: `Winning package selected. Export JSON or Markdown when ready.`
- After selection selected-export controls: JSON disabled = `False`, Markdown disabled = `False`
- Reload result: selection returned to `No winner selected` and selected-export JSON disabled = `True`. This means the browser selection action itself was review proof, not durable approval.
- Ready/blocking language detected in package engine context: `blocked, blocked, blocked`.

## Screenshots actually captured

- `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/package-engine-initial.png`
- `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/package-engine-selected.png`
- `/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-export-import-initial.png`

## Screen recording

No screen recording was captured in this session.

## Failures or limitations

- Built-in browser navigation failed earlier with a CDP connection error, so proof was captured through a headless Chrome CDP helper instead.
- The package engine `Download selected JSON` control became enabled after selecting a winner, but the scripted browser helper did not capture a selected-package JSON download from that button. The repository already contains `selected-package.json`, and this proof does not claim a new package-engine selected JSON download was accepted.
- The browser selection did not persist across reload; after reload the UI returned to `No winner selected`.
- The package engine did not falsely mark the run as ready; blocked language was still present.

## Conclusion

Partial pass. The local app loaded, the May 2 package workflow was visible, controls were visible, and selecting the candidate changed the UI state without production approval. The selected package export button was enabled but its download was not captured by this browser helper, and the UI selection did not persist after reload.
