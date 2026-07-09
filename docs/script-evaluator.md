# Super Focus — Script Evaluator

The Script Evaluator scores a Super Focus project's **saved** script against the
VIDTOOLZ standard and returns an advisory verdict. It is a read-and-advise tool:
it **never approves the script, never advances the project, and never generates
media**. The verdict is guidance for Mikko — the human still decides everything.

The standard it scores against: *a VIDTOOLZ script is good when it gives the
viewer a sharper way to think AND gives the production system clear things to
build.*

## How to open it

- In Super Focus, open or create a project and scroll to the **Script
  evaluation** section (directly under Step 2 — Script / voiceover), or
- Use the **VIDTOOLZ Script Evaluator** desktop shortcut, which opens
  `http://127.0.0.1:8010/super-focus.html?focus=script-evaluator`. That URL is
  the ordinary Super Focus page in *focus mode*: it adds a hint and scrolls to
  the evaluation section once a project is open. The Super Focus landing screen
  is unchanged — it still shows only **Create a new video project** and **Open an
  existing video project**.

Install (or reinstall — the installer is idempotent and does not touch the Super
Focus shortcut):

```bash
scripts/install-script-evaluator-shortcut.sh          # port 8010
scripts/install-script-evaluator-shortcut.sh 8011     # custom port
```

## Using it

1. Save a non-empty script (Step 2). The **Evaluate script** button is disabled
   until a saved script exists — unsaved textarea edits do not count; the
   evaluator reads the persisted script only.
2. Click **Evaluate script**. This runs a single **local Ollama** pass on vidnux.
   There is **no cloud fallback** and no OpenAI use. If Ollama is unreachable the
   evaluation fails with a clear error and nothing is persisted.
3. Read the panel: total score, verdict, per-category and per-sentence detail,
   and a single **next edit**. Edit the script, **Save** it, and re-run.

## What the panel shows

- **Score / verdict / band** — total out of 100, one of `PRODUCE`,
  `PRODUCE_MINOR_EDITS`, `REVISE`, or `REWRITE`.
- **Hard gates** — three pass/fail gates (central claim in one sentence,
  speakable naturally, generates useful visuals). A failing gate **caps the
  verdict at REVISE** regardless of the numeric score, and the panel says so.
- **Categories** — nine weighted categories (weights sum to 100) with the points
  each contributed and a recommendation.
- **Checklist** — ten pass/warn/fail items.
- **Top strengths / top problems**, **per-sentence** scores with concrete
  `edit_suggestion` / `optional_rewrite`, a **fix plan**, and the single
  **next edit**.
- **Warnings** — e.g. the model invented or omitted a sentence id (omitted
  sentences are shown as `unevaluated` using the backend's authoritative text).

## Staleness

The evaluation is stamped with a hash of the script it scored. When you save a
changed script, the stored evaluation is marked **stale** (never deleted) and the
panel shows a "Script changed after this evaluation — re-run to refresh" banner.
Reverting the script to the evaluated text clears the stale flag.

## Boundaries

- **Advisory only.** No auto-approval, no gate advancement, no media generation.
- **Local semantic pass only** (Ollama on vidnux). No cloud fallback, no OpenAI,
  and **no external fact-checking** — the evaluator judges craft and structure,
  not whether real-world claims are true, and is prompted not to pretend to
  verify the internet.
- Persisted to the project's `super-focus.json` as `script_evaluation`
  (`schema_version` stamped); read back read-only on project open.

## State and API

- **POST** `/api/super-focus/evaluate-script` `{id}` — nonce-gated; runs the
  local pass, scores, and persists. 400 on empty script, 404 on unknown project,
  502 on unparseable model output (nothing persisted), 503 when Ollama is down.
- **GET** `/api/super-focus/script-evaluation?id=<id>` — read-only; returns
  `{project_id, script_evaluation, stale}`. No Ollama, no mutation.
- Pure scoring/prompt/parse/normalize logic lives in `script-evaluator.js`
  (fully unit-tested, no I/O). Persistence and staleness live in
  `super-focus.js`.
