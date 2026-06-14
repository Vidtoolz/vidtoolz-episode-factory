# Gate 5 — Assembly Manifest

- **Run:** `2026-06-06-ai-replace-editors-wrong-question`
- **Working title:** "AI Won't Replace Editors. Here's What Actually Happens."
- **Created:** 2026-06-07
- **Status:** Gate 5 — Assembly Edit (IN PROGRESS — awaiting Mikko edit)
- **Target:** ~2-minute vertical 9:16 video (1080×1920, 30fps)

---

## 1. Approved Background Video Assets (Set A — Wan A14B, PRESTO)

All six videos generated via Wan A14B I2V on PRESTO, prompt-fix regeneration (2026-06-07).
Every file verified: 1080×1920, 30fps, h264, history-verified.

| # | Concept | Source file (D:\AI\ComfyUI\output\video\) | Size | Duration |
|---|---------|------|------|----------|
| A1 | Split screen: AI-cut cold vs human-cut warm | `ai_replace_editors_wrong_question_promptfix_batch1_01_split-screen-cold-warm_20260607-081500_00001_.mp4` | 1.2 MB | 2.7s |
| A2 | Audio waveform with held silence | `ai_replace_editors_wrong_question_promptfix_batch1_02_waveform-held-silence_20260607-081500_00001_.mp4` | 0.9 MB | 2.7s |
| A3 | Clock / edit-marker meditation | `ai_replace_editors_wrong_question_promptfix_batch1_03_clock-edit-markers_20260607-081500_00001_.mp4` | 1.0 MB | 2.7s |
| A4 | Evolution montage: razor → Avid → NLE → AI | `ai_replace_editors_wrong_question_promptfix_batch2_04_evolution-montage_20260607-081500_00001_.mp4` | 1.4 MB | 2.7s |
| A5 | Director's chair behind timeline | `ai_replace_editors_wrong_question_promptfix_batch2_05_directors-chair_20260607-081500_00001_.mp4` | 1.2 MB | 2.7s |
| A6 | Editor silhouette, tools accumulating | `ai_replace_editors_wrong_question_promptfix_batch2_06_editor-silhouette-tools_20260607-081500_00001_.mp4` | 2.0 MB | 2.7s |

**All verified via presto-runner manifests:** resolution `1080x1920`, fps `30/1`, codec `h264`, `verified_by_history: true`.

---

## 1b. Approved Background Video Assets (Set B — Kling, GPT images → Kling AI)

Eight additional clips generated from GPT image prompts → Kling AI video generation (2026-06-07).
Intended as supplementary background visuals behind green-screen talking head.

| # | Concept | Source file | Size | Duration |
|---|---------|-------------|------|----------|
| B1 | TBD | TBD | TBD | TBD |
| B2 | TBD | TBD | TBD | TBD |
| B3 | TBD | TBD | TBD | TBD |
| B4 | TBD | TBD | TBD | TBD |
| B5 | TBD | TBD | TBD | TBD |
| B6 | TBD | TBD | TBD | TBD |
| B7 | TBD | TBD | TBD | TBD |
| B8 | TBD | TBD | TBD | TBD |

**⚠️ Awaiting Kling clip filenames and paths from Mikko to complete this table.**

---

## 2. Superseded / Rejected Assets — DO NOT USE

The following filenames in `D:\AI\ComfyUI\output\video\` are **deprecated** due to runner bugs (LoadImage override + positive prompt override). Exclude from Resolve import:

- `ai_replace_editors_wrong_question_batch1_*.mp4` — wrong LoadImage override (stale first-frame images)
- `ai_replace_editors_wrong_question_batch2_*.mp4` — wrong positive prompts (generic template prompts, not concept-specific)
- `ai_replace_editors_wrong_question_replacement_*.mp4` — interim replacement pass, superseded by promptfix

**Only `*promptfix*` files are valid for Gate 5 assembly.**

---

## 3. Approved Script

- **File:** `script.md` (Draft 2, revised, Gate 1 approved)
- **Structure:** 6 sections — Hook, Setup, Claim, Example, Closing, CTA
- **Tone:** Talking to a friend. Warm, personal, self-deprecating.
- **Visual cue map:** lines 106–115

---

## 4. Talking-Head Recording

- **Status:** ✅ RECORDED (2026-06-07) — green screen, script read complete
- **Location:** ⚠️ Still on local machine — needs transfer to VIDNAS before Resolve import
- **Expected destination:** `\\VIDNAS\Public\VIDTOOLZ\03_SHARED_MEDIA_LIBRARY\camera_originals\`
- **Action for Mikko:** Transfer the talking-head recording from local machine to VIDNAS camera_originals, then update path below.
- **Recording path (TBD):** `________________` (fill after transfer)

---

## 5. Script-to-Visual Mapping (Edit Plan)

**Two background clip pools available (14 total):**
- **Set A (Wan A14B):** 6 clips — cinematic-conceptual, 2.7s each, mapped to specific script beats below
- **Set B (Kling):** 8 clips — GPT image → Kling video, available for supplementary coverage

Mikko decides final placement during the Resolve edit. The original Wan mapping below is the baseline; Kling clips fill gaps, extend sections, or replace as needed.

| Sequence | Script Section | Script Lines | Background Video (Primary) | Visual Notes |
|----------|---------------|-------------|---------------------------|--------------|
| 1 — HOOK | Hook: "People keep asking me if AI will replace editors…" | 15–21 | Set A1 — Split screen cold/warm | Mikko on green screen. Background: split-screen cold AI-cut vs warm human-cut. Use for opening seconds. |
| 2 — HISTORY | Setup: "I've seen this movie before…" — NLE transition, "anyone can cut but not everyone can edit" | 25–34 | Set A4 — Evolution montage | Razor → Avid → NLE → AI fades. Play under Mikko VO. |
| 3 — CLAIM | The claim: "Real editing is judgment…" — timing, knowing what the director means | 39–45 | Set A1 — Split screen cold/warm | Return to split-screen. Left: mechanical AI-cut. Right: human pacing. |
| 4 — EXAMPLE | Concrete example: news-editing moment — holding reaction over quote, gut vs timeline | 51–63 | Set A2 — Waveform held silence | Close-up of waveform with glowing held silence gap. The space between cuts. |
| 5 — REFRAME | "Direct, don't compete" — editor as director of tools, not competitor | 69–77 | Set A3 — Clock/edit-marker meditation | Clock face with edit markers as hands. Slow, deliberate, warm cycle. |
| 6 — CLOSING | "The real threat isn't AI" — pattern repeats, craft doesn't change | 83–88 | Set A5 — Director's chair behind timeline | Director's chair with "EDITOR" label behind glowing timeline. |
| 7 — CTA | "Stop asking if AI will replace you" — tools accumulate, editors survive by learning | 95–101 | Set A6 — Editor silhouette, tools accumulating | Silhouette against warm gold. Tools circle: razor → keyboard → AI prompt. |

**Note:** Set A1 (split-screen) is used twice — Hook (#1) and Claim (#3). Looping or re-timing recommended in Resolve. Set B Kling clips can supplement any sequence where the 2.7s Wan clips need extension or variety.

---

## 6. DaVinci Resolve Assembly Checklist

- [ ] **Pre-flight**
  - [ ] Transfer talking-head recording from local machine to VIDNAS camera_originals
  - [ ] Copy the six Set A `*promptfix*` mp4 files from `D:\AI\ComfyUI\output\video\` to a Resolve-accessible folder on VIDNAS
  - [ ] Copy the eight Set B Kling mp4 files to the same Resolve-accessible folder on VIDNAS
  - [ ] Verify no superseded files (`batch1`, `batch2`, `replacement`) are in the Resolve media pool
  - [ ] Create Resolve project on ROJEKTI project server with package-run ID in name
  - [ ] Set timeline to 1080×1920, 30fps, vertical

- [ ] **Media import**
  - [ ] Import talking-head A-roll (green screen)
  - [ ] Import six Set A promptfix background videos
  - [ ] Import eight Set B Kling background videos
  - [ ] Confirm each background clip plays correctly (Media Offline = blocked, investigate path)
  - [ ] Rename any non-ASCII Kling filenames to ASCII-safe before import (Resolve mojibake issue)

- [ ] **Assembly**
  - [ ] Layer 1 (background): Place background videos on V1 per the edit plan — Set A as primary, Set B as supplement
  - [ ] Layer 2 (talking head): Place green-screen A-roll on V2, key out green
  - [ ] Adjust background timing — most Wan clips are 2.7s; use Kling clips to extend or vary sequences
  - [ ] Set A1 (split-screen) used in sequences 1 and 3 — re-timing or duplicate in timeline
  - [ ] Match background transitions to script pacing (not just hard cuts)

- [ ] **Review**
  - [ ] Watch-through with script open — does every beat land?
  - [ ] Check green-screen key quality
  - [ ] Check background video framing against talking-head placement
  - [ ] Export rough-cut for Mikko review (do NOT export final)

---

## 7. Next Approval Gate

**Gate 5 is NOT complete until Mikko reviews the rough assembly.**

- **Mikko watches rough-cut** → fills watch-notes (fillable form TBD if requested)
- **Mikko approves** → Gate 5 marked complete
- **Then:** Gate 7 — Title, Thumbnail, Packaging Prep
- **Then:** Gate 8 — Final Export & Publish

(Gate 6 — Camera Shoot — assumed complete with the pending talking-head transfer.)
