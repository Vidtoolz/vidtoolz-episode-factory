# VIDTOOLZ Video Production System — Usage Guide

Grounded in the real system state as of 2026-06-29.
Active run: 2026-06-28-stop-writing-your-shorts-like-blog-posts (production prep / production-brief stage).
Superseded inactive run: 2026-05-06-ai-video-proof-plan.
Tests: run `scripts/verify.sh` for the current count. Cockpit port: 8010.

---

## BEFORE YOU START

The cockpit runs on vidnux at http://127.0.0.1:8010.
Start it from terminal:

  cd /home/vidtoolz/vidtoolz-episode-factory
  node package-engine-server.js

The AIGEN Review View is a separate server on port 8099.
Start it separately when you need image review (Phase 7).

---

## THE 13-STAGE PIPELINE

The system follows this canonical pipeline (defined in pipeline-tracker.js):

  0  Idea            —   one-sentence claim
  1  Research        —   credible sources
  2  Script          —   A-roll/B-roll marked script
  3  Claims Check    —   every assertion verified
  4  Packaging       —   title, thumbnail, metadata
  5  Image Prompts   —   FLUX prompts for B-roll
  6  Image Gen       —   FLUX images generated
  7  Image Select    —   best images chosen
  8  Video Gen       —   Wan2.2 or Kling clips (MANUAL)
  9  A-Roll Record   —   presenter on camera
 10  Assembly Edit   —   DaVinci Resolve timeline (MANUAL)
 11  Publish Gate    —   final review and packaging check
 12  Published       —   upload to YouTube

The Runs Dashboard shows a visual pipeline tracker at the top.
The Workflow Wizard panel shows step-by-step guidance for the current stage.

---

## HOW TO RESUME AN EXISTING RUN

If you already have an active run (like now), do NOT restart from Phase 2.
Do this instead:

1. Open http://127.0.0.1:8010/package-runs-dashboard.html
2. Look at the "Productions Overview" section at the top — it lists all runs
3. Click your active run to focus it (2026-06-28-stop-writing-your-shorts-like-blog-posts)
4. Read the "Next Safe Action" panel — it reads local evidence only and tells you:
   - What stage you are at
   - What is already done
   - What the next real action is
   - What evidence exists
   - What remains blocked
5. Read the STATUS.md file in the run folder for the decision you need to make
6. Check the Visual Beat Map panel — it shows all 37 beats from 3 sources:
   - resolve-spine-cut-marker-map.md (13 markers)
   - media-creation-plan.md (15 clip cards)
   - final-script.md (9 narrative sections)
7. Resume from whatever phase the Next Safe Action indicates

Right now your active run is at production prep / production-brief stage.
The immediate blocker is that production-brief.md does not exist yet.
Do not move to FLUX, PRESTO/Wan, Resolve, or publish actions until production prep is complete.

---

## HOW TO START A NEW RUN (FROM SCRATCH)

Only do this if you do not have an active run.

### PHASE 1: IDEA (Stage 0)

1. Open http://127.0.0.1:8010/index.html — Episode Factory home
2. Click "Package Engine" or use the Runs Dashboard "New episode" option
3. A new package-run folder is created under package-runs/ with a timestamped name
4. Write your one-sentence claim in idea.md in the run folder
5. Identify target audience — default is YouTube Short, 9:16 vertical, 1-3 minutes
6. Note the emotional hook — why someone would share this
7. Keep it to one claim, one example, one point

### PHASE 2: RESEARCH (Stage 1)

8. Find 2-3 credible sources that support the claim
9. Use ChatGPT or ask Hermes to web_search for sources — do not invent sources
10. Capture source URLs and key quotes in research-pack.md
11. Identify the single strongest example to build the video around
12. Write a research-sufficiency check: is there enough proof to proceed?
13. If research is thin, stop and pick a different idea

### PHASE 3: SCRIPT (Stage 2)

14. Draft the script in ChatGPT following: one claim, one example, one point
15. Keep it under 250 words (target 1-3 minutes of speech)
16. Mark presenter segments with [A-ROLL] and generated visuals with [B-ROLL]
17. Save as script-draft.md, then revise through QA passes
18. Save the approved version as final-script.md
19. The script should have clearly marked sections (Hook, Setup, Promise, Parts, Recap, CTA)
20. Read it aloud and time it — adjust if over 3 minutes

### PHASE 4: CLAIMS CHECK (Stage 3)

21. Read final-script.md and list every factual assertion
22. Cross-check each assertion against research-pack.md sources
23. Flag any unsupported claims for revision or removal
24. Record the check result in STATUS.md — only proceed if all claims are supported

### PHASE 5: PACKAGING (Stage 4)

25. Write 3-5 title candidates — curiosity-driven, under 60 characters
26. Describe a thumbnail concept
27. Set target duration, aspect ratio (9:16), and platform in youtube-package.json
28. Run title and thumbnail through a fit-check: does the title match the script promise?
29. Save packaging decisions in selected-package.md and youtube-package.json
30. Do not finalize title or thumbnail yet — that happens at Publish Gate (Stage 11)

### PHASE 6: IMAGE PROMPTS (Stage 5)

31. Review final-script.md B-roll markers — each [B-ROLL] tag needs a visual
32. Open http://127.0.0.1:8010/image-prompts-editor.html
33. Write FLUX prompts for each visual beat in image-prompts.json
34. Each prompt: subject, style, mood, composition for 9:16 vertical
35. Keep prompts concrete — "warm kitchen interior, soft light, vertical" not "a nice room"
36. Save and validate the JSON

### PHASE 7: IMAGE GENERATION (Stage 6)

37. Two paths: vidnux local FLUX or PRESTO ComfyUI
38. For vidnux local FLUX: run the handoff adapter — reads image-prompts.json, outputs to package/images/flux-local/
39. vidnux ComfyUI: ~/comfy/ComfyUI, FLUX.1 Dev GGUF Q8_0, ~48s per image at 1080x1920
40. For PRESTO ComfyUI: http://192.168.50.187:8188
41. Check output: images should appear in package/images/flux-local/ with a flux-generation-manifest.json
42. Inspect each image — does it match the script beat? Is it 9:16? Is quality acceptable?

### PHASE 8: IMAGE SELECTION (Stage 7)

43. Open the AIGEN Review View at http://127.0.0.1:8099 (separate server)
44. For each prompt, review the generated image(s)
45. Select the best image or flag for regeneration
46. Selected images move to staging for video generation
47. If an image is wrong, go back to Phase 7 and regenerate with adjusted prompt
48. Do not proceed to video generation until all B-roll images are selected

### PHASE 9: VIDEO GENERATION (Stage 8) — MANUAL, MIKKO OPERATES

Hermes can prepare handoffs (list which stills, expected filenames, destination paths)
and verify files exist after creation, but cannot generate clips or operate Kling/ComfyUI.

49. Two paths: PRESTO Wan2.2 I2V or Kling web UI
50. For PRESTO Wan2.2: queue selected images through ComfyUI on PRESTO
51. Wan2.2 settings: 81 frames, ~2.7 seconds, ~12 minutes render per clip
52. Do NOT use 149 frames / 5 seconds — this has timed out in production
53. For Kling: use the web UI to generate clips needing longer motion
54. CRITICAL: Rename ALL generated media to ASCII-safe hyphenated names
    Examples: kling-setB2-03.mp4, wan-scene01-81f.mp4
    No Chinese characters, spaces, or parentheses in filenames
55. Kling outputs 1080x1916 (4px short of 1920) — Resolve needs a 4px crop or pad
56. Move staged MP4 files to VIDNAS:
    /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-image-assets/<topic>/kling-video-candidates/
57. Verify all B-roll clips are on VIDNAS and accessible from Resolve clients

For the current active run, there is no Kling/PRESTO handoff yet.
Finish production prep first and verify the generated production artifacts before creating media.

### PHASE 10: A-ROLL RECORDING (Stage 9)

58. Set up OBS on vidnux with green screen, camera, and microphone
59. Open final-script.md and identify all [A-ROLL] segments
60. Record presenter segments matching the script A-roll markers
61. Save recordings to VIDNAS: /mnt/vidnas_public/VIDTOOLZ/camera_originals/
62. Tell Hermes which take to move into the active run subfolder — be explicit
63. Hermes moves the newest take and runs ffprobe inspection
64. Review the ffprobe output: resolution, frame rate, duration, codec
65. If the take is good, approve it as the A-roll source
66. If the take has issues, re-record — do not keep bad takes
67. All A-roll MP4 files must be on VIDNAS before proceeding to assembly

### PHASE 11: ASSEMBLY EDIT IN RESOLVE (Stage 10) — MANUAL, MIKKO OPERATES

Hermes scope stops here. Hermes can prepare the marker map, clip cards, and
media-creation plan, and verify files are on VIDNAS, but cannot operate Resolve.

68. Open DaVinci Resolve on PRESTO or vidnux
69. Create a new Resolve project
70. Import A-roll from VIDNAS — do not copy files locally, use VIDNAS as media source
71. Import B-roll from VIDNAS — the staged MP4 clips from the aigen lane
72. Open resolve-spine-cut-marker-map.md for the 13 markers (M01-M13)
73. Cut the A-roll to script timing — follow the marker map
74. Place B-roll over the marked sections — each [B-ROLL] tag gets its clip
75. Fix Kling 1916px height: scale or crop to 1920 in Resolve project settings
76. Add green screen keying — remove green background from A-roll
77. Add GPT-to-Kling backgrounds or FLUX images behind presenter where needed
78. Color match: ensure A-roll and B-roll look consistent
79. Set audio levels: voice peak around -6dB, music/ambience under -20dB
80. Add the opening hook — place a marker at the opening hook
81. Insert A-roll closeups or pickup clips at visual-support points
82. Do not solve all visual-support candidates at once — just the first one, then iterate
83. Export as H.264 1080x1920 30fps
84. Save the exported MP4 to VIDNAS, not to a local drive

### PHASE 12: PUBLISH GATE (Stage 11)

85. Watch the exported video end-to-end with no interruptions
86. Open the "Mikko Input Console" in the Runs Dashboard — the rough-cut review panel
87. Fill rough-cut-watch-notes.md with timestamps and observations
88. Record the reviewed file name, watch date, and reviewer name
89. Classify the gate status: Ready, Needs Pickups, Needs Re-edit, or Rejected
90. If needs pickups: create a pickup-list.md and go back to Phase 10-11
91. Run title and thumbnail through the packaging gate
92. Confirm all claims are still supported by research sources
93. Only proceed to publishing if the gate is "Ready" — do not bypass the gate

### PHASE 13: PUBLISH (Stage 12) — MANUAL, MIKKO OPERATES

94. Upload to YouTube as a Short (9:16, under 3 minutes)
95. Set the title from youtube-package.json
96. Set the description and tags from the package metadata
97. Set the thumbnail
98. Record the YouTube URL in published-videos.json
99. Update STATUS.md in the run folder to "Published"
100. The pipeline tracker will show stage 12 complete

### PHASE 14: MEASURE AND REFLECT

101. After 48 hours, check YouTube Studio analytics: views, watch time, retention
102. Record what worked and what did not in notes.md — feed lessons into next idea

---

## FRICTION LOGGING

During production runs, capture every blocker as it happens.

Use the Friction Log panel in the Runs Dashboard — not direct API calls.
The dashboard UI fetches the local-write nonce automatically from
/api/package-engine/status and includes it in the save request.

If you script friction logging externally, you must:
1. GET /api/package-engine/status to obtain localWriteNonce and nonceHeader
2. Include both in your POST to /api/package-runs/friction-log/save

A direct POST without the nonce will get 403.
This was a real bug found during validation — friction-log.js was missing the nonce.
Fixed on 2026-06-22. Regression tests in tests/friction-log-nonce.test.js.

The current active run is not at the friction-log / rough-cut repair stage.
Use the Runs Dashboard and package-run audit output for the next safe action.

---

## KEY FILES IN A PACKAGE RUN

Each video is a folder under package-runs/ containing:

  idea.md                        — the one-sentence claim
  research-pack.md               — sources and quotes
  final-script.md                — approved script with A-roll/B-roll markers
  STATUS.md                      — current stage, gate status, next decision
  package-run-state.md           — active/inactive state (DO NOT TOUCH)
  rough-cut-watch-notes.md       — review notes (source of truth for gate)
  image-prompts.json             — FLUX prompts for B-roll backgrounds
  youtube-package.json           — title, thumbnail, metadata
  resolve-spine-cut-marker-map.md — 13 markers for Resolve timeline
  media-creation-plan.md         — 15 clip cards with visual job per beat
  selected-package.md            — packaging decisions
  production-plan.md             — production prep notes
  FRICTION-LOG.json              — structured friction entries
  second-cut-visual-support-map.md — visual candidates with insert instructions

---

## COCKPIT URLS

Main dashboard      http://127.0.0.1:8010/package-runs-dashboard.html
Episode Factory home http://127.0.0.1:8010/index.html
Package Engine       http://127.0.0.1:8010/package-engine.html
Image Prompts Editor http://127.0.0.1:8010/image-prompts-editor.html
Mission Control      http://127.0.0.1:8010/mission-control.html
Production Day       http://127.0.0.1:8010/production-day-dashboard.html
Idea Scout           http://127.0.0.1:8010/daily-idea-scout.html
AIGEN Review View    http://127.0.0.1:8099 (separate server)
Publish Gate         http://127.0.0.1:8010/publish-gate.html

---

## KEY RULES

- The Runs Dashboard is your main control surface
- The Workflow Wizard panel shows step-by-step guidance for the current stage
- The Next Safe Action panel reads local evidence and tells you what to do now
- The Visual Beat Map panel shows all beats from 3 sources in one view
- Hermes scope stops at Resolve editing — stages 0-9 are Hermes-assisted
  stages 10-12 are Mikko's manual domain
- Kling video generation is manual — Hermes prepares handoffs, cannot operate Kling
- No file is approved, published, or marked ready without Mikko's explicit sign-off
- package-run-state.md must not be touched by anyone except Mikko
- rough-cut-watch-notes.md is the single source of truth for review status
- When resuming an existing run, always start from Next Safe Action
- Friction log entries go through the dashboard UI (nonce required for saves)
- No new features should be built until one end-to-end run completes with a friction log

---

## YOUR CURRENT NEXT ACTION

Your active run (2026-06-28-stop-writing-your-shorts-like-blog-posts) is at production prep / production-brief stage.

The current blocker is:

1. PRODUCTION PREP:
   production-brief.md is missing.
   The production-prep generator also requires a selected package file
   (selected-package.json or selected-package.md) before it can create the brief.

Do not create media, start PRESTO/Wan, open Resolve work, or publish anything until
the production-prep artifacts exist and the dashboard/audit reports the next safe action.
