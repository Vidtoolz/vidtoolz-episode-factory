# VIDTOOLZ Super Focus — User Instructions
# How to take one video from idea to finished clips
# Verified against the live system on 2026-07-20 (all 4 services green).
# Repo: /home/vidtoolz/vidtoolz-episode-factory  ·  App: http://127.0.0.1:8010/super-focus.html

═══════════════════════════════════════════════════════════════════════════
WHAT SUPER FOCUS IS
═══════════════════════════════════════════════════════════════════════════
A minimal, single-flow production view. One video on screen at a time, nothing
else. It is a standalone mini-app inside Episode Factory — separate from the
aigen "project" model and from package-runs. It never touches those.

The golden rule of the whole app:
    NOTHING generates or advances itself. Every step is an explicit click.
    A model can draft, but only YOU approve. The model never approves anything.

Open it:
  • Desktop shortcut:  "11-Super-Focus"
  • Or browser:        http://127.0.0.1:8010/super-focus.html

Landing screen = exactly two choices:
  [ Create a new video project ]   [ Open an existing video project ]


═══════════════════════════════════════════════════════════════════════════
BEFORE YOU START — check the 4 services (top-of-page status panel)
═══════════════════════════════════════════════════════════════════════════
When you open a project, a status panel shows the 4 local services. All must
be green/"ok" for the full flow. Verified live 2026-07-20:

  Service            Machine  Engine            Used for
  ─────────────────  ───────  ────────────────  ─────────────────────────────
  vidnux Ollama      vidnux   qwen3:14b         topic, script, image prompts
  vidnux ComfyUI     vidnux   FLUX 1080x1920    still images
  PRESTO Ollama      PRESTO   vidtoolz-presto   image-to-video (i2v) prompts
  PRESTO ComfyUI     PRESTO   Wan2.2 vertical   video clips (~54 min each!)

If a service is down the app shows a clear BLOCKED state (HTTP 503) — it will
NEVER silently fall back to another host or to a cloud service. That is by
design. Fix the service, then continue.

  Restart vidnux ComfyUI:   bash ~/bin/start-vidnux-comfyui.sh   (on vidnux)
  Restart PRESTO ComfyUI:   manual on PRESTO (no remote restart button)

NOTE (seen live): PRESTO ComfyUI was down earlier today (000) and the panel
correctly flagged it. After you brought both ComfyUIs up, all 4 report "ok".


═══════════════════════════════════════════════════════════════════════════
THE FLOW — one linear sheet, top to bottom
═══════════════════════════════════════════════════════════════════════════
Work down the steps in order. Each step has a Save button; nothing is kept
until you Save. Generate buttons stay DISABLED (with a tooltip reason) until
their prerequisite is SAVED — this is a soft gate, the server enforces it too.

Prerequisite chain:  saved Title → saved Script → saved Prompts → Images
                     → approved Image review → i2v prompt → Video → Video review

───────────────────────────────────────────────────────────────────────────
STEP 1 · TITLE
───────────────────────────────────────────────────────────────────────────
  • Type a title, OR click "Generate a topic for VIDTOOLZ" (vidnux Ollama).
  • Click SAVE. The title is not kept until you save.
  Tip: the generated topic is a draft — edit it freely before saving.

───────────────────────────────────────────────────────────────────────────
STEP 2 · SCRIPT / VOICEOVER
───────────────────────────────────────────────────────────────────────────
  • Write one, OR click "Generate" to draft from the saved title.
  • Target length for a Short: ~390–450 words (2:15–2:50 spoken).
  • "Expand script" grows the box to show the whole script (no auto-save).
  • Optional: Script Evaluator. Open with the URL flag:
        super-focus.html?id=<project>&focus=script-evaluator
    (this forces the Script step open so the evaluator is reachable).
  • SAVE. This is the spine of the whole video — get it right here.

───────────────────────────────────────────────────────────────────────────
STEP 3 · VISUAL PLAN  (beats + visual assignments)
───────────────────────────────────────────────────────────────────────────
Built from the SAVED script. Central idea:
    A prompt says WHAT to generate.
    A visual assignment says WHAT JOB the visual must do in the argument.

  1. "Create beats" — splits the script into beats. (Version numbers like
     "Wan 2.2" never split a beat.)
  2. Mark any beat "presenter-only" or "reuse-previous" if it needs no visual.
  3. "Generate missing assignments" — drafts assignments in small batches
     (vidnux Ollama). It NEVER overwrites an existing assignment.
  4. Edit each assignment. Under "Why this visual?" it carries: viewer task,
     visual function, what it must show, acceptance criteria, media type.
  5. APPROVE each assignment yourself. Approval is yours alone.

  Safety behaviours (verified in docs):
    • Split/merge beats → assignments survive, flagged "Needs review".
    • Saved script changes → plan marked STALE (never deleted).
      "Re-anchor" rebinds unchanged beats and flags the rest.
    • Editing/generating/approving against a stale plan → blocked (409).

───────────────────────────────────────────────────────────────────────────
STEP 4 · MAIN IMAGE PROMPTS
───────────────────────────────────────────────────────────────────────────
  • "Create prompts from approved assignments" writes one prompt per approved,
    fresh, image-lane assignment. Skipped rows always say WHY (presenter-only,
    not approved, rejected, prompt already exists, …).
  • Prompts are background-plate style: no text, no people, clean lower-right
    space for your presenter overlay. (Matches your standing rule: no rendered
    text — narration in a FLUX prompt causes text to render.)
  • Editing an assignment later marks its prompt "needs review" — nothing is
    deleted. Revert the assignment to byte-identical and the flag clears.
  • Older whole-script "Prompt count" generation (1–100, default 8) still works
    if you have no plan. All 100 slots stay editable (Copy / Save changes).

───────────────────────────────────────────────────────────────────────────
STEP 4b · GENERATED IMAGES
───────────────────────────────────────────────────────────────────────────
  • Set "Images to generate" (1–100, default 3), then generate/resume the
    first N saved prompts (vidnux ComfyUI / FLUX). Thumbnails appear inline.
  • Uses --skip-existing, so re-running a batch is safe and resumes.
  • One GPU job at a time (global FLUX lock); a second submit returns 409.

───────────────────────────────────────────────────────────────────────────
STEP 4c · IMAGE REVIEW  (gate before any video)
───────────────────────────────────────────────────────────────────────────
Every generated image is EVIDENCE. You review it against the assignment's
acceptance criteria before it may become a video. The OPERATOR decides, never
a model.

  1. "Start a review" — snapshots the exact image bytes + criteria (sha256).
  2. Mark each criterion pass / fail / n-a (N/A needs a note).
  3. "Approve image" or "Reject image".
     • A failed criterion blocks normal approval.
     • "Approve with override" is a separate confirmed action + mandatory reason.
  • Approval stays valid only while hashes match reality: regenerate the image,
    edit the assignment, or change criteria → flips to "Needs re-review".
  • I2V GATE: video generation only consumes approved-and-current images.
  • Legacy images (pre-review) are labelled "Legacy — review provenance
    unknown" and stay video-eligible in compatibility mode.

  IMAGE REVIEW WORKBENCH (focused one-at-a-time mode, from the images/videos
  step): one dominant image, one context panel, one explicit decision bar.
  No batch approve, no model approve. Every decision binds to the exact sha256
  of the image shown — if bytes differ, the server refuses (409) and records
  nothing. Candidate order is deterministic (queue-linked & undecided first).

───────────────────────────────────────────────────────────────────────────
STEP 5 · INFOGRAPHIC PROMPTS  (optional)
───────────────────────────────────────────────────────────────────────────
  • Choose a "Prompt count" (1–30, default 6) → still infographic prompts from
    the script (prompt-only, no images generated here).

───────────────────────────────────────────────────────────────────────────
STEP 6 · IMAGE-TO-VIDEO (i2v) PROMPTS
───────────────────────────────────────────────────────────────────────────
  • One per generated image: "Create a video prompt" (PRESTO Ollama lane).
  • This describes the MOTION you want on top of the approved still.

───────────────────────────────────────────────────────────────────────────
STEP 7 · GENERATED VIDEOS
───────────────────────────────────────────────────────────────────────────
  • Batch ("Queue missing videos" — asks confirmation, rendering is expensive)
    or per-image ("Queue video on PRESTO" — the safest default).
  • PRESTO ComfyUI / Wan2.2, HQ profile. A real HQ clip ≈ 54 minutes.
  • Clips appear inline per row.

  VIDEO QUEUE — day/night control (this is the important one for you):
    • PAUSE queue   — no NEW PRESTO render starts; running render left alone;
                      queued items preserved. Survives a cockpit restart.
                      This is the SAFE daytime control.
    • RESUME queue  — clears pause; starts next eligible clip ONLY if the
                      PRESTO lock is free and PRESTO reachable. Never auto-
                      starts PRESTO/ComfyUI.
    • STOP current  — pauses queue, stops the LOCAL process, marks the item
                      stopped_by_operator (never "done"). Honest limit: it
                      cannot guarantee the REMOTE PRESTO GPU job stops.
    • Queue audit ("Audit paused video queue") — the ONLY safe way to inspect
                      a paused queue. Read-only: no pump, no PRESTO contact.
                      Classifies each item (safe_to_resume / stale_prompt /
                      source_unapproved / …) with estimated GPU runtime.

    RECOMMENDED WORKFLOW:  pause during the day, resume at night.

    LIVE STATE RIGHT NOW: the queue on project "Why ai generated clips feel
    like stock footage" is PAUSED (since 2026-07-09, "safe deployment pause"),
    82 live items, all classified legacy_compatibility. Resume is a separate
    explicit click when you're ready.

───────────────────────────────────────────────────────────────────────────
STEP 7b · VIDEO REVIEW  (gate before the edit)
───────────────────────────────────────────────────────────────────────────
The clip is EVIDENCE, reviewed against the production contract before it may
enter the edit. Same operator-only model as image review.

  • Criteria categories: the assignment's own acceptance criteria (a still
    pass does NOT transfer to motion), presenter composition, motion (serves
    the assignment, no prohibited motion, subject stays recognizable), and
    technical usability (decodes, clean first/last frames, no morph/flicker).
  • You MUST set a usable range (seconds, or "full clip usable") before
    approval.
  • Override requires a recorded reason; it can NEVER bypass a missing clip,
    changed source image, stale assignment, or drifted i2v prompt.
  • Edit/handoff eligibility = approved-and-current review + current usable
    range + current source-image approval. Revoking the image approval blocks
    the clip downstream.
  • Render-time provenance: every dispatch stages an immutable copy of the
    exact source still, so the review compares against the bytes that actually
    produced the clip — "proven" / "changed since render" / "unknown (legacy)".


═══════════════════════════════════════════════════════════════════════════
AFTER THE CLIPS — the human finish line
═══════════════════════════════════════════════════════════════════════════
Super Focus stops at approved clips. The rest is your normal VIDTOOLZ flow:
  1. Record yourself on physical camera (green screen, lower-right).
  2. Edit in DaVinci Resolve (project server on ROJEKTI 192.168.50.199).
  3. Approved AI clips are background plates behind you — they support the
     spoken idea, they are not the video.
  4. Edited media goes to VIDNAS only. Deliverables to 04_DELIVERABLES.


═══════════════════════════════════════════════════════════════════════════
USABILITY FINDINGS & IMPROVEMENT IDEAS  (from testing 2026-07-20)
═══════════════════════════════════════════════════════════════════════════
What already works well (verified):
  ✓ Soft-gate buttons are disabled with a reason until the prerequisite is
    saved — you can't fire a step early by accident.
  ✓ Status panel correctly flagged PRESTO ComfyUI down this morning, and shows
    green now that you brought both ComfyUIs up. Honest, no silent fallback.
  ✓ Nothing auto-advances; every mutation is an explicit click. Matches your
    "AI cannot approve taste" rule.
  ✓ Hash-bound reviews mean an approval can never silently transfer to a
    regenerated image/clip. Strong evidence discipline.
  ✓ Queue pause survives a restart (verified live — it's been paused since
    Jul 9 and is still correctly paused after today's cockpit restart).

Friction / gaps worth considering (NOT bugs — design observations):
  1. No remote restart for PRESTO ComfyUI. When it drops you must go to PRESTO
     manually. A single "Restart PRESTO ComfyUI" button (even if it just SSHs
     a known-safe command) would remove a context switch. The routing doc
     calls remote restart a "non-goal", so this is a deliberate boundary —
     but it's the most common operational hiccup.
  2. Script Evaluator is hidden behind a URL flag (?focus=script-evaluator)
     and returned 404 as a standalone page. If you use it, a visible button
     in the Script step would be friendlier than remembering the flag.
  3. The desktop shortcut is named "11-Super-Focus". The "11-" prefix is
     opaque. Renaming to "VIDTOOLZ Super Focus" would read better on the
     desktop (it already sorts; the number isn't load-bearing).
  4. No in-app indication of the ~54-minute-per-clip cost until you read the
     docs. A small "≈54 min each · runs one at a time" hint near "Queue video"
     would set expectations at the decision point.
  5. The providers panel shows PRESTO image as "not_configured" (PRESTO FLUX
     workflow not installed). That's fine for the current vertical-explainer
     format, but it's a dead lane that could confuse. Either hide it until
     configured or label it "future / optional".

I did NOT change any code — these are observations for you to approve before
any implementation. Per your rule, implementation goes to Claude Code via a
task prompt once you pick which of these you want.


═══════════════════════════════════════════════════════════════════════════
OPERATIONAL COMMANDS (for you / Hermes)
═══════════════════════════════════════════════════════════════════════════
  Restart cockpit after a code update (API routes are compiled in):
      systemctl --user restart vidtoolz-cockpit.service

  Verify the whole system (tests):
      cd ~/vidtoolz-episode-factory && ./scripts/verify.sh

  Check the 4 services (read-only, no nonce needed):
      curl -s http://127.0.0.1:8010/api/super-focus/providers | python3 -m json.tool

  Inspect a paused queue safely (read-only, the ONLY safe way):
      curl -s "http://127.0.0.1:8010/api/super-focus/video-queue-audit?id=<project_id>"

  Storage audit of render-attempt evidence (read-only):
      curl -s "http://127.0.0.1:8010/api/super-focus/attempt-storage?id=<project_id>"

NOTE: write actions (create project, save, generate, approve) require the
in-browser session nonce — the server generates it fresh on each start and
only hands it to the page. This is a security feature: you cannot drive writes
from curl without the live nonce. Do all real work through the browser UI.


═══════════════════════════════════════════════════════════════════════════
STATE & FILES (where things live)
═══════════════════════════════════════════════════════════════════════════
  Project state (canonical, local, file-based):
      <repo>/super-focus-projects/<project_id>/super-focus.json   (git-ignored)
  Generated media (VIDNAS, media-only):
      /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/super-focus/<project_id>/
          images/flux-local/flux-NNN.png
          videos/mp4-hq-720p/NNN.mp4
  Routing policy (single source of truth, no silent fallback):
      config/media-routing.json
  Media files are the source of truth — reconciled from disk on every poll,
  so state survives a server restart.
