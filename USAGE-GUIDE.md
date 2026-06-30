# VIDTOOLZ Cockpit — Operator Guide

Cockpit: http://127.0.0.1:8010

---

## DAILY STARTUP

1. Click desktop shortcut **01-Resume-Work**
   Checks VIDNAS, starts cockpit if needed, opens resume page with project list.

2. Click desktop shortcut **02-Systems-Check**
   Opens an HTML readiness report: VIDNAS, PRESTO, ComfyUI, Ollama, cockpit.

3. Click your project card on the resume page, or click desktop shortcut **09-Open-Active-Run** to jump straight to the active run in the dashboard.

The dashboard Orientation Strip (top) shows: current gate, blocker, next action. Read it first, every time.

---

## RESUMING A RUN

1. Open the dashboard (shortcut **05-Creator-Cockpit** or **09-Open-Active-Run**).
2. Read the Orientation Strip. It tells you the current gate and next action.
3. Do the action it says. Use the dashboard forms — not manual file editing.
4. After each action, the dashboard auto-refreshes the gate status.

### Gates and what you do at each one

**Needs package selection**
Use the Beginning Triage panel in the dashboard. Fill the topic, candidate angles, and package fields. Click Select. The dashboard writes selected-package.md for you.

**Needs script**
Vertical path: open shorts-workflow.html (?run=<run-id>). Generate scripts with Ollama, pick one, edit it, click "Save this as final-script.md".
Longform path: write the script in your editor of choice, then paste it into the dashboard script field.

**Needs script review**
Run the script review from the dashboard. It writes script-review.md and shows the result inline.

**Needs production plan**
The dashboard generates the production plan, shot list, and planning artifacts. Review them in the Artifact Panel (read-only, with copy buttons). Edit planning files only if the plan needs adjusting — these are generated templates, not gate evidence.

**Needs capture**
1. Record A-roll, screen captures, and audio (see A-ROLL RECORDING below).
2. In the dashboard, open the Capture Evidence Intake panel.
3. Fill the form: take name, media file path, screen recording name and path, audio item and path.
4. Click **Preview write** — review the generated markdown rows.
5. Click **Apply to run files** — writes to takes-log.md, screen-recording-checklist.md, and audio-capture-checklist.md automatically.
6. The gate advances when real media references are detected and the approval marker is set.

**Needs rough cut**
1. Edit in Resolve (manual — your domain).
2. Export a rough cut to VIDNAS.
3. In the dashboard, open the Rough Cut Review form.
4. Fill: candidate file path, watch date, reviewer, notes for each dimension (opening, pacing, clarity, visual trust, etc.).
5. Select approval marker: NOT GIVEN / NEEDS PICKUPS / NEEDS EDIT FIXES / PASS.
6. Submit. The dashboard writes rough-cut-watch-notes.md and runs the review gate.

**Needs second cut** (if rough cut needed pickups)
Same pattern: edit in Resolve, export, fill the Second Cut Review form in the dashboard, submit.

**Needs final review**
Watch the final edit. Fill the Final Candidate Review form in the dashboard: candidate path, watch date, reviewer, notes for all dimensions. Submit. The dashboard writes final-watch-notes.md and final-review.md.

**Needs export/mastering**
Fill the Export Master form in the dashboard: codec confirmation, file details. Submit. The dashboard writes export-checklist.md and master-file-manifest.md.

**Needs publication metadata**
Fill the Delivery Readiness form in the dashboard. Submit. The dashboard writes delivery-readiness.md and checks publication metadata.

**Ready to publish**
1. Upload to YouTube manually.
2. Record the YouTube URL in the dashboard or in published-videos.json.
3. Set package-run-state.md to "published" (only you do this).

---

## STARTING A NEW RUN

1. Click desktop shortcut **03-Build-New-Video**
   Opens the guided step-by-step build page (new-video-build.html).

2. Follow the steps on screen. Each step has checkboxes and buttons that open the right tool:
   - Step 1: Pick topic (Topic Scout)
   - Step 2: Research and outline (Package Engine)
   - Step 3: Write script (shorts-workflow.html for vertical, editor for longform)
   - Steps 4-5: Claims check and packaging (longform only)
   - Step 6: Image prompts (Image Prompts Editor)
   - Step 7: Image generation (ComfyUI)
   - Step 8: Image selection (AIGEN Review)
   - Step 9: Video generation (PRESTO Wan2.2 — manual)
   - Step 10: A-roll recording (manual)
   - Steps 11-14: Resolve edit, publish gate, publish, reflect (manual)

The build page links to each tool directly. You do not need terminal commands for any step.

---

## A-ROLL RECORDING (MANUAL)

1. Click desktop shortcut **06-Start-ComfyUI** if you need FLUX backgrounds running.
2. Set up OBS: green screen, camera, microphone.
3. Open the script in the dashboard Artifact Panel (read-only, copyable) or in shorts-workflow.html.
4. Record presenter segments. Save to VIDNAS: /mnt/vidnas_public/VIDTOOLZ/camera_originals/
5. Tell Hermes which take to move into the active run subfolder.
6. Click desktop shortcut **07-START-CAPTURE** for 4K screen capture with system audio + Elgato mic.
7. Click desktop shortcut **08-STOP-CAPTURE** to stop and verify the recording.
8. Back in the dashboard, use the Capture Evidence Intake form to log what you recorded.

---

## IMAGE GENERATION (B-ROLL BACKGROUNDS)

1. Open http://127.0.0.1:8010/image-prompts-editor.html
   Write prompts: subject + style + mood, vertical 9:16. Photorealistic only. No text of any kind in prompts.

2. Click desktop shortcut **06-Start-ComfyUI** to start local FLUX.
   ~48s per image at 1080x1920. Crashes after ~33-50 generations — auto-restarts.

3. Review and select images at http://127.0.0.1:8099 (AIGEN Review View).

4. Generate video clips on PRESTO (Wan2.2 I2V, 81 frames, manual). Stage to:
   /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/

---

## ASSEMBLY EDIT IN RESOLVE (MANUAL)

Hermes scope stops here. Open DaVinci Resolve on PRESTO or vidnux.

1. Import media from VIDNAS (do not copy locally).
2. Cut A-roll to script timing. Place B-roll over [B-ROLL] sections.
3. Key green screen. Add generated backgrounds behind presenter.
4. Fix Kling 1916px height (scale or crop to 1920).
5. Color match. Set audio levels (voice ~-6dB, music ~-20dB).
6. Export H.264 1080x1920 30fps to VIDNAS.
7. Watch the rough cut end-to-end.
8. Fill the Rough Cut Review form in the dashboard (not a .md file).

---

## PUBLISH

1. Open http://127.0.0.1:8010/publish-gate.html
2. Verify trust checklist: claims verifiable, AI visuals classified, no misleading thumbnails.
3. Upload to YouTube manually.
4. Record the YouTube URL.
5. Set package-run-state.md to "published" (only you).

---

## TROUBLESHOOTING

**Dashboard blank or "Could not load"**
Click desktop shortcut **01-Resume-Work** — it starts the cockpit if it's not running.

**Doctor says BLOCKED but I did the work**
The gate needs an approval marker set via the dashboard form, not just file existence. Re-open the relevant panel in the dashboard, fill the required fields, and submit.

**Orientation Strip says "stale index"**
Click "Rebuild index" on the dashboard.

**ComfyUI crashed after many generations**
Auto-restart should handle it. If not, click desktop shortcut **06-Start-ComfyUI** again.

**Want to see all gates at once**
Scroll the dashboard — the Pipeline Tracker shows every gate and its status.

---

## DESKTOP SHORTCUTS

| # | Shortcut | What it does |
|---|----------|-------------|
| 01 | Resume-Work | Check VIDNAS, start cockpit, open resume page |
| 02 | Systems-Check | Full readiness report (HTML) |
| 03 | Build-New-Video | Open guided new-video build page |
| 04 | Episode-Factory | Open Episode Factory index |
| 05 | Creator-Cockpit | Open dashboard |
| 06 | Start-ComfyUI | Start local FLUX ComfyUI |
| 07 | START-CAPTURE | Start 4K screen + audio capture |
| 08 | STOP-CAPTURE | Stop capture, verify file |
| 09 | Open-Active-Run | Open active run in dashboard (never stale) |

---

## KEY RULES

1. The Orientation Strip is the single source of truth for "what do I do next." Read it first.
2. Use dashboard forms for every gate. Do not open .md files to edit them manually.
3. File existence does not prove completion. Gates use evidence, not file existence.
4. Hermes cannot approve, publish, edit timelines, or operate Resolve/ComfyUI/Kling.
5. package-run-state.md is touched only by you.
6. No gate is bypassed. If the doctor says BLOCKED, it is blocked.
7. All image generation is local FLUX on vidnux. No external API keys.
