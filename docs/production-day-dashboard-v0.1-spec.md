# VIDTOOLZ Production-Day Dashboard — v0.1 Spec

## Status
Planning spec for Codex. Not yet built. Not integrated with any workflow system.

## What this is
A single static HTML file that Mikko opens in a browser on production day. It tracks an 8-phase production workflow against a 10-hour countdown. When a phase overruns its stop-loss limit, the dashboard shows the fallback instruction.

## What this is NOT
- A database
- A workflow engine
- Connected to package-run state
- A publishing tool
- A durable record
- An approval system
- A replacement for human judgment

---

## File

```
/home/vidtoolz/vidtoolz-episode-factory/production-day-dashboard.html
```

Single file. Zero dependencies. No CDN. No Node server required. Open with any browser (`file://` or via the existing package-engine-server).

---

## Layout

### Top bar
- Left: "VIDTOOLZ Production Day" + today's date
- Right: Countdown timer (HH:MM:SS remaining, counting down from 10:00:00)
- Below: Start button ("Begin Production Day") — hidden once clicked

### Main grid: 8 phase cards (2 columns on desktop, 1 column on mobile)
Each card shows:
- Phase number and name
- Target duration (minutes)
- Status icon: ⏳ waiting / ▶ active / ✅ complete / ⚠ overrun
- When active: elapsed time for this phase (MM:SS counting up)
- Stop-loss time limit (different from target)
- Fallback instruction (revealed when overrun)
- Checkbox to mark complete → advances to next phase

### Trust checklist panel (collapsed by default, expandable)
Appears below phase cards. 6 checkboxes:
1. All factual claims verifiable or marked as opinion
2. Every AI visual classified (evidence / illustration / decoration / metaphor / simulation / fiction)
3. Non-evidence AI visuals labeled on-screen
4. Current-event sources cited in description (date + source)
5. Any visual that could mislead → cut or relabeled
6. Thumbnail reviewed for misleading claims

Each item shows a red "✗" until checked, then green "✓".

### Print-friendly checklist (hidden on screen, visible in @media print)
Single-page summary: all 8 phases with target times, stop-loss limits, and the trust checklist. Minimal styling. Black on white. Shows today's date as title.

---

## Phase Definitions

### Phase 1: Script + Structure
- **Target**: 45 min
- **Stop-loss**: 60 min
- **Fallback**: "Switch to bullet points (3-5 beats + hook + rule). Stop writing full sentences."
- **Description**: Write tight script. Hook (2 sentences), body (3-5 beats), rule card (1 sentence), close.

### Phase 2: Camera Setup + Shoot
- **Target**: 60 min
- **Stop-loss**: 90 min
- **Fallback**: "Use best take so far. Fix gaps in fine edit. Do not re-shoot."
- **Description**: Light, frame, record. 2-3 takes of script. Clean presenter B-roll for inserts.

### Phase 3: AI Asset Generation
- **Target**: 90 min
- **Stop-loss**: 90 min (hard stop)
- **Fallback**: "Use pre-built backgrounds and templates. Skip custom AI generation. The rule carries the video."
- **Description**: Generate backgrounds, illustrations, B-roll elements. Run batch prompts. Queue ComfyUI jobs early.

### Phase 4: Screen Recording
- **Target**: 30 min
- **Stop-loss**: 45 min
- **Fallback**: "Use screenshots with voiceover instead of full recording."
- **Description**: Capture timeline, tool output, workflow step. Can overlap with Phase 3.

### Phase 5: Assembly Edit
- **Target**: 60 min
- **Stop-loss**: 90 min
- **Fallback**: "Lock the rough cut. Move to fine edit. Perfection is for later."
- **Description**: Rough cut. A-roll on timeline. Mark insert points. Place AI assets and screen recordings.

### Phase 6: Fine Edit + Grade
- **Target**: 60 min
- **Stop-loss**: 90 min
- **Fallback**: "Skip grading beyond basic correction. Audio level check only. Publish the honest version."
- **Description**: Tighten cuts. Color grade. Audio levels. Insert rule card. Add labels to AI visuals.

### Phase 7: Review + Trust Check
- **Target**: 30 min
- **Stop-loss**: 45 min
- **Fallback**: "Run the trust checklist. Fix only red-flag issues. Ship."
- **Description**: Watch full video. Run trust checklist (expandable panel). Fix any trust issues. No creative re-editing.

### Phase 8: Export + Thumbnail + Publish
- **Target**: 45 min
- **Stop-loss**: 60 min
- **Fallback**: "Use thumbnail template swap. Write minimal description. Publish now, refine metadata later."
- **Description**: Export final. Create thumbnail. Write title, description, tags. Upload. Add cards/end screens. Publish.

---

## Music Note
Music is not a production-day phase. It is expected to be selected from a pre-built weekly batch (prepared separately using Ableton/Reaper). The dashboard includes a small reminder at the top: "Music: select from weekly batch (not created today)."

---

## Behavior Rules

1. **One phase active at a time.** Starting a new phase marks the previous complete.
2. **Countdown runs continuously** from "Begin Production Day" click. Does not pause. If Mikko takes a break, the timer reflects real elapsed time.
3. **Stop-loss triggers are advisory, not blocking.** When a phase exceeds its stop-loss, the card turns yellow with a warning icon and shows the fallback text. It does not lock or prevent continuing.
4. **Phase completion is manual.** Mikko checks the box when done. The next phase auto-activates.
5. **No data persists.** Refresh the page → reset. This is intentional. The dashboard is for today only.
6. **Print mode** (@media print) hides the timer, phase statuses, and interactivity. Shows only: title with date, phase list with target times, stop-loss rules, trust checklist. Ready to pin on the wall.

---

## Visual Design

- **Theme**: Dark background (#1a1a2e or similar), light text. Fits editing bay lighting.
- **Active phase**: Highlighted border or glow. Clearly different from waiting/completed.
- **Overrun phase**: Yellow/amber border, warning icon.
- **Completed phase**: Green checkmark, muted opacity.
- **Timer**: Large, prominent. Red when under 2 hours remaining.
- **Font**: System font stack. No webfonts.
- **Responsive**: Works on a 1080p monitor (intended use). Mobile layout as secondary.

---

## What NOT to Build

- No localStorage or sessionStorage
- No backend API calls
- No package-run integration
- No episode tracking
- No workflow state machine
- No notifications or alerts
- No audio cues
- No keyboard shortcuts (except checkbox toggling via space/enter)
- No progress bars (numeric timers only — bars create false precision)
- No "save" or "load" functionality
- No export beyond browser print
- No multi-day tracking
- No user accounts or profiles

---

## Verification

After Codex builds, verify:
1. File opens in browser via `file://`
2. "Begin Production Day" starts the countdown
3. Each phase can be activated and marked complete
4. Stop-loss triggers display when phase time exceeds limit
5. Trust checklist checkboxes all work
6. Print preview shows checklist, not interactive UI
7. Refresh resets everything (no state persists)
8. No console errors
9. No network requests in DevTools
10. Works at 1920×1080 and 1366×768

---

## Codex Implementation Prompt

```
Build a single static HTML file at:
/home/vidtoolz/vidtoolz-episode-factory/production-day-dashboard.html

It is a production-day execution tracker for a solo YouTube creator.

REQUIREMENTS:

LAYOUT:
- Dark theme, system fonts, no dependencies, no CDN.
- Top bar: "VIDTOOLZ Production Day" (left), countdown timer HH:MM:SS from 10:00:00 (right).
- "Begin Production Day" button that starts the timer and hides itself.
- 8 phase cards in a 2-column grid (single column on narrow screens).
- Collapsible trust checklist panel below the cards.
- Print stylesheet: single-page checklist, black on white, no interactive UI.

EACH PHASE CARD SHOWS:
- Phase number, name, target duration, status icon
- Statuses: waiting (⏳), active (▶), complete (✅), overrun (⚠)
- When active: elapsed timer counting up (MM:SS)
- Stop-loss time limit (may differ from target)
- Fallback instruction text (visible only when overrun)
- Checkbox: mark complete → advances to next phase, stops current phase timer
- Overrun: card border turns amber, warning icon, fallback text appears

PHASE DEFINITIONS (phase, target min, stop-loss min, fallback):

1. Script + Structure | 45 | 60 | "Switch to bullet points (3-5 beats + hook + rule). Stop writing full sentences."
2. Camera Setup + Shoot | 60 | 90 | "Use best take so far. Fix gaps in fine edit. Do not re-shoot."
3. AI Asset Generation | 90 | 90 | "Use pre-built backgrounds and templates. Skip custom AI generation. The rule carries the video."
4. Screen Recording | 30 | 45 | "Use screenshots with voiceover instead of full recording."
5. Assembly Edit | 60 | 90 | "Lock the rough cut. Move to fine edit. Perfection is for later."
6. Fine Edit + Grade | 60 | 90 | "Skip grading beyond basic correction. Audio level check only. Publish the honest version."
7. Review + Trust Check | 30 | 45 | "Run the trust checklist. Fix only red-flag issues. Ship."
8. Export + Thumbnail + Publish | 45 | 60 | "Use thumbnail template swap. Write minimal description. Publish now, refine metadata later."

MUSIC REMINDER:
Small text near the top: "Music: select from weekly batch (not created today)."

TRUST CHECKLIST (collapsible panel, 6 checkboxes):
1. All factual claims verifiable or marked as opinion
2. Every AI visual classified (evidence / illustration / decoration / metaphor / simulation / fiction)
3. Non-evidence AI visuals labeled on-screen
4. Current-event sources cited in description (date + source)
5. Any visual that could mislead → cut or relabeled
6. Thumbnail reviewed for misleading claims
- Each item: red ✗ default, green ✓ when checked
- "All trust checks passed" summary when all 6 are checked

BEHAVIOR:
- Only one phase active at a time. Checking a phase complete activates the next.
- Timer never pauses. Break time counts against the 10 hours.
- Stop-loss is advisory only — shows warning, doesn't block progress.
- No data persists. Refresh = full reset. This is intentional.
- Phases can be completed without waiting for stop-loss. Normal flow: complete when done.

WHAT NOT TO INCLUDE:
- No localStorage, sessionStorage, cookies
- No fetch/XHR/network requests
- No backend, server, API
- No notifications, alerts, audio
- No save/load/export (except browser print)
- No progress bars (numeric timers only)
- No keyboard shortcuts beyond default checkbox behavior
- No multi-day, profiles, or settings pages

PRINT MODE (@media print):
- Hide: countdown timer, phase status icons, Begin button, interactive checkboxes
- Show: title with today's date, phase list (name + target + stop-loss), trust checklist as plain text, fallback instructions
- Single page if possible, black text on white

VERIFY AFTER BUILDING:
1. Opens from file:// with no errors
2. Begin button starts global countdown
3. Phases activate sequentially
4. Stop-loss triggers at correct times
5. Trust checkboxes toggle
6. Print preview clean and complete
7. Refresh resets everything
8. Zero network requests
9. Works at 1920×1080

Build the complete file now. Do not ask questions. Use today's actual date from JavaScript.
```