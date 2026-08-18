# Operator handoff — native Earth Studio template evidence (Gate 0/1)

Status: **BLOCKED — OPERATOR EARTH STUDIO EXPORTS REQUIRED**

Why: Google Earth Studio needs your authenticated Google session. Your running
Chrome 151 has no DevTools endpoint, and since Chrome 136 the
`--remote-debugging-port` flag is silently ignored on the *default* profile.
The agent must not relaunch your browser or copy any credentials, so one of
the two options below is needed. **Option 1 is preferred** (agent then
automates all 15 references); Option 2 needs only one manual export to unblock
Gate 0.

---

## OPTION 1 — expose an Earth Studio session over CDP (preferred)

1. Leave your normal Chrome running; this uses a separate window+profile.
2. Launch a second Chrome instance with a dedicated debug profile:

   ```bash
   google-chrome --user-data-dir="$HOME/.chrome-earthstudio-debug" \
     --remote-debugging-port=9222 https://earth.google.com/studio/
   ```

3. In that new window, sign in to your Google account **yourself** (the agent
   never touches credentials; the debug profile stays on this machine and can
   be deleted after the research: `rm -rf ~/.chrome-earthstudio-debug`).
4. Confirm Earth Studio loads to the project screen.
5. Tell Claude Code to continue. It will verify the endpoint
   (`http://127.0.0.1:9222/json/version`), attach with the repo's
   puppeteer-core, prove it controls only the Earth Studio tab (screenshot),
   then run the Gate 0 probe and the 15-reference matrix, exporting each
   project via **File → Export → Save project (.esp / ⌘E)** and saving
   evidence under `package-runs/2026-08-18-earth-studio-native-templates/`.

## OPTION 2 — fully manual Gate 0 probe (one export)

1. In Earth Studio: **File → New → Quick Start → “Fly-To and Orbit”**.
2. Before clicking through, note every visible setup value (duration, fps,
   aspect, rotations, direction, altitude/radius fields — screenshot each
   wizard step: `PrtSc` or your usual tool).
3. Location: search **Eiffel Tower** (expected ≈ 48.858370, 2.294481 — accept
   the native search result).
4. Keep ALL template defaults — change nothing unless the wizard forces a
   choice; if it does, screenshot the choice first.
5. Name the project exactly: `VIDTOOLZ-TPL-FLY-ORBIT-PROBE`.
6. Export: **File → Export → …(.esp)** (⌘E / Ctrl-E — record the exact menu
   wording you see).
7. Save the file as downloaded, unmodified, to:
   `~/vidtoolz-episode-factory/package-runs/2026-08-18-earth-studio-native-templates/gate0/`
8. Put the wizard screenshots in the same folder.
9. Verify the file exists (`ls -la` on that folder), then tell Claude Code to
   continue — it will hash the export, parse it with the existing read-only
   inspector, decide the acquisition branch (A/B/C/D), and prepare the full
   15-project matrix instructions (or automate them via Option 1).

Do **not** delete the Earth Studio project afterwards — research projects stay
until the whole task closes (naming scheme `VIDTOOLZ-TPL-*`).
