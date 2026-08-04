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
- **Scale ambiguity advisory** — when category scores appear to use a global
  0–10 scale, or mix likely 0–10 and 0–100 rows, the saved result carries
  `scale_ambiguous: true`. The panel shows a separate warning banner beside the
  score/verdict. This does not fail or cap the advisory verdict; it means the
  normalized arithmetic and apparent verdict require human review.
- **Hard gates** — three pass/fail gates (central claim in one sentence,
  speakable naturally, generates useful visuals). A failing gate **caps the
  verdict at REVISE** regardless of the numeric score, and the panel says so.
- **Categories** — nine weighted categories (weights sum to 100) with the points
  each contributed and a recommendation.
- **Checklist** — ten pass/warn/fail items.
- **Top strengths / top problems**, **per-sentence** rows with concrete
  `edit_suggestion` / `optional_rewrite`, a **fix plan**, and the single
  **next edit**.
- **Warnings** — e.g. the model invented a sentence id, omitted the hook row,
  or returned no sentence rows at all (in that last case sentences are shown
  as `unevaluated` using the backend's authoritative text).

### Selective sentence contract (speed)

Output tokens dominate local-Ollama latency, so the prompt asks for sentence
rows **only for sentences that need work** (status `revise` or `cut`), plus
**always one row for the first sentence (the hook)**. An omitted sentence id
means "okay — no change needed" and is rendered as an implied-`okay` row with
no invented role or score. Per-sentence `positives` / `negatives` /
`highlighted_phrases` are no longer requested; anything the model still emits
for them is dropped (the fields stay in the saved shape, always empty). The
actionable value — `edit_suggestion` and `optional_rewrite` — is unchanged.

Fail-honest guardrails: if the model returns **zero** valid sentence rows, the
contract was ignored, so every sentence is marked `unevaluated` with a single
warning (never silently "all okay"). If rows come back but the hook row is
missing, the hook is treated as okay and a warning says so.

## Parser and normalization behavior

The response parser accepts the existing strict JSON, fenced JSON, surrounding
prose, and thinking-block cleanup paths. It can unwrap at most **four wrapper
levels**. It follows one deterministic object path and never traverses arrays or
performs an arbitrary deep-tree search. An evaluation deeper than four wrappers,
or a response with no evaluation-shaped object, fails closed with no persisted
evaluation.

At each examined wrapper level, if several direct child objects independently
look like evaluations, the parser chooses the `evaluation` key when present;
otherwise it uses stable object-key order. It does not merge, average, or select
by score. The normalized evaluation includes a warning naming the selected key.
A nested object with only one familiar evaluation property is not sufficient to
be accepted as an evaluation.

Category scale handling is deterministic:

- A wholly 0–10-looking category response keeps the compatible multiply-by-10
  conversion and sets `scale_ambiguous: true`.
- In a mixed response containing category scores above 10, a 0–10 category is
  multiplied by 10 only when that category also has a recognized `pass` status.
  The warning lists affected category IDs in canonical rubric order and the
  same ambiguity field is set.
- Low categories with failing or non-passing statuses are not upscaled. Normal
  0–100 scoring and verdict bands are unchanged.

The backend-generated sentence list and IDs remain authoritative. Duplicate
normalized sentence IDs retain the compatible **last valid row wins** rule and
emit a warning for each overwrite. Rows with missing or invalid/non-integer IDs
are ignored with distinct warnings; valid integer IDs that are absent from the
authoritative list keep the existing invented-ID warning. There is no positional
sentence fallback. Under the selective contract, an authoritative sentence with
no returned row is an implied `okay` (no warning) whenever at least one valid
row was returned; with zero valid rows all sentences are `unevaluated`.

Sentence splitting remains dependency-free, deterministic, and deliberately
limited. It protects leading numbered-list markers, decimals and dotted
versions/model names, the fixed abbreviations `e.g.`, `i.e.`, `Dr.`, `Mr.`,
`Mrs.`, `Ms.`, `vs.`, and `etc.`, URL/domain dots, periods inside unmatched
parentheses, and closing quote/parenthesis punctuation. Newlines remain hard
script-line boundaries.

## Prompt-content mitigation

The prompt places the exact backend sentence list inside
`SENTENCE_DATA_BEGIN` / `SENTENCE_DATA_END` and the exact full script inside
`SCRIPT_DATA_BEGIN` / `SCRIPT_DATA_END`. The preceding instruction states that
the delimited content is untrusted data, may contain commands as script text,
and must not override the evaluator instructions. The content is not sanitized,
omitted, or paraphrased.

These delimiters reduce prompt-injection risk for small local models; they
**do not** create a security boundary or guarantee instruction isolation. Results
remain advisory and require human judgment.

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
  (`schema_version` stamped, including `scale_ambiguous`); read back read-only on
  project open.

## State and API

- **POST** `/api/super-focus/evaluate-script` `{id}` — nonce-gated; runs the
  local pass, scores, and persists. 400 on empty script, 404 on unknown project,
  502 on unparseable model output (nothing persisted), 503 when Ollama is down.
- **GET** `/api/super-focus/script-evaluation?id=<id>` — read-only; returns
  `{project_id, script_evaluation, stale}`. No Ollama, no mutation.
- Pure scoring/prompt/parse/normalize logic lives in `script-evaluator.js`
  (fully unit-tested, no I/O). Persistence and staleness live in
  `super-focus.js`.
