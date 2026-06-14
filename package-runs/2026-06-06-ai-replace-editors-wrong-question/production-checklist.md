# Production Checklist

**Package:** 2026-06-06-ai-replace-editors-wrong-question
**Working title:** "AI Won't Replace Editors. Here's What Actually Happens."
**Status:** Gate 4 ✅ COMPLETE. 6 Wan A14B + 8 Kling background videos approved. Talking-head recorded. Gate 5 assembly edit underway in Resolve (see `gate-5-assembly-manifest.md`).

---

## Approval Gates (in order)

### Gate 1: Topic & Package Approval
- [x] Mikko approves the topic and production pattern
- [x] Mikko picks working title
- [x] Mikko confirms script direction, requests revisions
- [x] Mikko approves first visual set (6 of 12 concepts)
- **Status:** ✅ APPROVED 2026-06-06

### Gate 2: Script Lock & Visual Prompts
- [x] Script Draft 2 approved for production; only spoken-read-through polish allowed
- [x] 6 visual prompts approved with adjustments (director's chair, evolution montage)
- [x] Script and visual prompts locked
- **Status:** ✅ APPROVED 2026-06-06

### Gate 3: Background Image Generation
- [x] Batch 1: concepts #1, #2, #3 — Mikko approved
- [x] Batch 2: concepts #4, #5, #6 — Mikko approved
- [x] All 6 images approved as Wan A14B input frames
- **Status:** ✅ APPROVED 2026-06-06

### Gate 4: Background Video Generation (PRESTO Wan A14B)
- [x] Batch 1: concepts #1, #2, #3 — 3 videos, all visually approved
- [x] Batch 2: concepts #4, #5, #6 — 3 videos, all visually approved (prompt-fix regeneration)
- [x] All 6 prompt-fix videos use correct first-frame images and concept-specific prompts
- [x] All 1080×1920/30fps, history verified
- [x] Old non-promptfix videos superseded — must not be used in the edit
- **Status:** ✅ COMPLETE 2026-06-07

### Gate 5: Thumbnail Generation
- [ ] Mikko picks thumbnail concept (from `title-thumbnail-options.md`)
- [ ] GPT generates thumbnail prompt
- [ ] Thumbnail generated (OpenAI/ComfyUI)
- [ ] Mikko approves thumbnail
- **Blocker:** Depends on Gate 1 (title locked) — can run in parallel with Gates 3–4

### Gate 6: Camera Shoot
- [x] Mikko shoots A-roll on green screen (script as reference)
- [ ] Takes logged to VIDNAS
- [ ] Hermes inspects take(s) with ffprobe
- [ ] Mikko selects best take
- **Status:** ✅ RECORDED 2026-06-07 — talking-head recorded on green screen. Transfer to VIDNAS pending.
- **Blocker:** Depends on Gate 2 (script locked)

### Gate 7: Assembly Edit (USER'S GATE 5)
- [x] Hermes assembly manifest created (`gate-5-assembly-manifest.md`)
- [x] 6 Wan A14B promptfix videos — Set A, approved
- [x] 8 Kling GPT→Kling videos — Set B, approved (supplementary)
- [x] Talking-head green screen recording completed
- [ ] ⚠️ Mikko transfers talking-head recording to VIDNAS camera_originals
- [ ] Mikko transfers background clips to Resolve-accessible VIDNAS folder
- [ ] A-roll rough assembly in Resolve
- [ ] Background clips placed per visual cue map (Set A primary, Set B supplement)
- [ ] Mikko reviews rough cut
- [ ] Pickups if needed
- **Blocker:** Depends on Gates 4 + 6

### Gate 8: Final Export & Publish
- [ ] Mikko approves final edit
- [ ] Export from Resolve to VIDNAS
- [ ] Title locked, description written, tags set
- [ ] Thumbnail final
- [ ] Upload to YouTube
- **Blocker:** Depends on Gate 7

---

## Policy Constraints (Active)

- Wan2.2-I2V-A14B only via PRESTO runner v1
- Max 3 jobs per batch, sequential, supervised
- No unattended generation
- Operator (Mikko) visual review after each job
- Stop on first technical failure or bad visual review
- Full batch policy: `hermes-organiser/brain/decisions/2026-06-06-presto-batch-policy.md`

---

## Current State

- **Active gate:** Gate 5 — Assembly Edit (checklist Gate 7)
- **Assembly manifest:** `gate-5-assembly-manifest.md` — 6 Wan A14B (Set A) + 8 Kling (Set B) background videos verified, script-to-visual mapping complete, Resolve checklist ready
- **Next action for Mikko:** Transfer talking-head + background clips to VIDNAS, begin rough assembly in Resolve
- **Talking-head:** ✅ Recorded (green screen, 2026-06-07). Pending transfer to VIDNAS camera_originals.
- **Kling clips:** 8 supplementary background clips generated (GPT images → Kling AI). Filenames TBD.
- **Gates 1–4 are locked. Gate 5 assembly is active.**
