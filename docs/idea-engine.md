# Idea Engine

Idea Engine generates, explains, refreshes, and promotes YouTube Shorts topic
ideas for the VIDTOOLZ channel: **12 configurable topic categories × 30
generated sub-topics (360 visible ideas)**, each with a premise, channel
relevance, Shorts suitability, central tension, and optional hook. A generated
idea is a **proposal** — nothing becomes a production commitment until Mikko
explicitly promotes it into Super Focus.

- **Page:** `idea-engine.html` (nav: More ▾ → Idea Engine)
- **Modules:** `idea-engine.js` (domain + persistence), `idea-engine-prompts.js`
  (prompt/spec layer), `idea-engine-ui.js` (GUI logic), routes in
  `package-engine-server.js`
- **State:** `idea-engine-state/` (git-ignored, local, never on VIDNAS;
  env-overridable via `IDEA_ENGINE_ROOT`) — `categories.json` + `ideas.json`
- **Generation:** local vidnux Ollama only (`/api/chat`, JSON-schema `format`,
  `think:false`), model `IDEA_ENGINE_OLLAMA_MODEL` → `OLLAMA_MODEL` → `qwen3.5:9b`

## Relationship to the existing Idea Module (~/vidtoolz-idea-module)

Idea Engine **coexists as a separate bounded subsystem** — a high-volume
exploration layer *upstream* of the Idea Module's curation gate. It was
deliberately NOT built into the Idea Module because that module's identity is
the opposite of volume exploration: hard WIP limits (pool 15 / dev 5 / prod 3)
enforced as doctrine, an anti-clutter mandate in its spec ("Curation over
collection… bulk ideation happens in external tools"), per-record Markdown
storage with full-corpus re-parse, no batch/run entity, and ADR-003 forbidding
cross-module runtime coupling. Idea Engine never reads or writes the Idea
Module's data and never bypasses its gates; if a surviving idea should enter
the curated pool, the Idea Module's own staged-import path remains the door.
Promotion here targets **Super Focus in this repo**, where the canonical
project-creation path already lives.

It also does not replace the Daily Idea Scout (evidence-scored daily
discovery), the user-seeded Topic Idea Scout (10 ideas from one seed), or the
Beginning Triage generator (topic-seed-only, no durable state) — those keep
their existing scopes.

## Data model

`categories.json` — seeded on first use with 12 default categories (no
canonical 12-category taxonomy existed in the estate; the seed is grounded in
the Tier-1 doctrine docs and the five content pillars). Persisted domain data:
edit the file to change names/guidance; edits win over the seed.
Each category: `id` (slug), `name`, `description`, `channel_relevance`,
`generation_guidance`.

`ideas.json` — per category: `batch` (batch_id, generated_at, model, provider,
requested, accepted, duration_ms, chunks, rejected_candidates), `ideas[≤30]`
(the ACTIVE list), `removed[]` (removal history — never physically deleted by
ordinary use), `promoted_history[]`, `last_failure`, `revision` (bumped on
every content mutation; stale-write protection for long-running generation).

Each idea: `id` (`ie-<8hex>`, always server-generated — model ids are never
trusted), `category_id`, content fields (`title`, `premise`, `why_vidtoolz`,
`why_short`, `tension`, `hook?`, `viewer_takeaway?`, `visual_opportunity?`),
`status` (`generated` | `reviewed`), `reviewed_at`, `created_at`, `updated_at`,
`batch_id`, `model`, and the Phase 2 editorial lifecycle:

- `content_origin`: `generated` | `manually_edited` | `replacement_generated`
- `edit_revision` (int) + `edit_history[]` (each entry: revision, edited_at,
  previous content snapshot) + `original_content` (the pre-first-edit snapshot)
- `removed`: `null` or `{at, reason, note}` (reason from the structured set:
  duplicate, too_broad, too_narrow, weak_vidtoolz_fit, poor_shorts_fit,
  already_covered, too_tool_specific, weak_tension, not_visually_explainable,
  inaccurate, superseded_by_refresh, other) + `removal_history[]` (restores)
- `replacement_for_idea_id` / `replaced_by_idea_id` (replacement provenance,
  both directions; a removed topic's id is never reused)
- `promotion` (`state`: `none` | `promoted` | `failed`, `project_id`,
  `promoted_at`, `promoted_revision` — the edit revision whose content went
  into the project — and `error`)

Schema evolution / migration: `loadState`/`loadCategories` normalize missing
fields (mirrors `super-focus.js readStateDir`), so Phase 1 state migrates on
read — legacy ideas gain `content_origin: generated`, `edit_revision: 0`,
empty histories, `removed: null`; categories gain `removed: []` and
`revision: 0`. Existing ids, batch ids, and promotion links stay valid
(covered by a legacy-state test). All writes are atomic (tmp + rename).
Corrupt JSON surfaces as 422.

## Topic lifecycle: edit, remove, restore, replace

A generated topic is a proposal the operator can improve before deciding
anything. Independent concerns are stored separately: content origin, review
state, availability (active/removed), and promotion state.

**Edit topic** (`POST /api/idea-engine/edit`): structured form in the detail
panel (Save/Cancel; no raw JSON). Content-only — id, category, batch/model
provenance, and promotion identity are immutable through editing, and no model
call happens. Every save validates required fields, length limits, HTML-like
markup, and exact/near-duplicate titles against all active topics; records an
edit revision; keeps the previous version in `edit_history` (the first edit
also freezes `original_content`); and marks the topic `manually_edited`.
Stale-write protection: the client sends the revision it loaded
(`expected_revision`); a mismatch returns 409 `stale_revision` so two tabs can
never silently overwrite each other. Editing an already-promoted topic updates
only the Idea Engine record — the GUI states plainly that the Super Focus
project keeps the content transferred at promotion time.

**Remove topic** (`POST /api/idea-engine/remove`): explicit action behind a
custom dialog showing the title, an optional structured reason, an optional
note, and three unambiguous buttons — Cancel / Remove only / Remove and
generate replacement. Removal moves the record to the category's removed
history with all provenance, edit history, and promotion metadata intact;
active count drops, vacancy count rises, and the category is shown as
`incomplete` — never padded with placeholders. Removing an already-removed
topic returns 409 `already_removed`. Removing a PROMOTED topic hides it from
active suggestions only; the UI says its Super Focus project is unchanged, and
no removal can ever delete, archive, or modify a project.

**Removed topics view**: per-category history list (`GET
/api/idea-engine/removed?category_id=`) with title, removal date/reason,
origin, edit-history indicator, promotion state, and replacement links.
Promoted removed topics stay discoverable and openable. Default search covers
active topics; an "include removed" toggle extends it to history.

**Restore topic** (`POST /api/idea-engine/restore`): same id, history kept
(the removal record moves into `removal_history`). Refused with a clear 409
when the category already has 30 active topics (`category_full` — nothing is
silently displaced; remove something first) or when restoring would duplicate
an active title (`restore_duplicate`).

**Generate replacement** (`POST /api/idea-engine/replace-one`): generates
exactly ONE candidate for a vacancy via a dedicated prompt that carries the
category definition, the removed topic (with an instruction not to reproduce
it), fixed guidance mapped from its structured removal reason (free-text notes
NEVER enter prompts), current active titles, deliberately removed titles,
promoted history, and the other 11 categories to avoid drifting into. Bounded
corrective retries (4 attempts; wrong item counts are rejected, never
trimmed); every candidate is validated against active topics everywhere,
promoted history, removed history, and the replaced topic itself, then
activated only if a vacancy still exists. The new idea gets a NEW server id
and is linked both ways (`replacement_for_idea_id` / `replaced_by_idea_id`).
Failure preserves the vacancy and the removal history untouched.

**Fill all vacancies** (`POST /api/idea-engine/fill-vacancies`): explicit
action; runs one replacement per vacancy sequentially, mapping vacancies to
the most recent unreplaced deliberate removals so each replacement carries its
removal reason as negative guidance. Reports `filled` / `failed` /
`partial_success` per slot honestly and can never exceed 30 active topics.

## Category capacity

The target is 30 active topics per category. After removals a category
honestly shows e.g. `Active: 28 / 30 · 2 vacancies` with completeness
`complete` | `incomplete` | `empty` (plus a live "generating" indicator while
a lane is busy). Deliberately removed titles are excluded from future
generation (validator always; prompt within its cap); refresh-superseded
history is archival and does not constrain future batches.

## Generation flow

1. Prompts come from `idea-engine-prompts.js`: doctrine-grounded system prompt
   (blunt production realist, 2:15–2:50 miniature evergreen explainer, 18-month
   durability test) + category guidance + exclusion list + strict JSON schema,
   returned as one `{system, user, schema}` unit. Each chunk rotates its
   concept shape (misconception / inversion / failure story / hard decision)
   and carries a title-variety rule; the validator additionally caps identical
   title openings (3/batch) and the degenerate "AI Can't/Doesn't …" family
   (10/batch), with the loop injecting a hard-ban instruction as the family
   quota fills (Phase 0 calibration, 2026-07-26: mold share 29/30 → 6/30).
2. The server generates in **chunks** (default 6 ideas/call, `IDEA_ENGINE_CHUNK_SIZE`,
   clamped 1–10; per-call timeout `IDEA_ENGINE_OLLAMA_TIMEOUT_MS` → `OLLAMA_TIMEOUT_MS`).
   Accepted candidates accumulate **in memory** — never in the active set.
3. Every candidate is validated (required fields, min/max lengths, exact +
   near-duplicate titles within the batch, against all other categories, and
   against every promoted idea). Model output is untrusted input; `<think>`
   blocks and fences are stripped; unparseable output twice in a row fails the
   run (502), as does a duplicate-echo stall.
4. **Activation is all-or-nothing:** only a set of exactly 30 valid ideas
   replaces the category (never 28, 29, or 31). Promoted ideas from the
   outgoing set move to `promoted_history` — promotion provenance survives
   every refresh. A failed run records `last_failure` on the category and
   leaves the previous valid set untouched (last-known-good preservation).

## Refresh semantics

- **Refresh one category** (`POST /api/idea-engine/refresh-category`,
  `{category_id, confirm:true}`) — replaces only that category; requires the
  explicit confirm flag (the GUI collects it in a custom dialog and states:
  "This replaces the current active suggestions for this category. Edited,
  removed, and promoted topics remain in history."); 409
  `generation_in_progress` if that category or a refresh-all is running.
  **History interaction:** on activation, promoted old actives move to
  `promoted_history`, everything else (manual edits included) is archived to
  `removed` as `superseded_by_refresh` — nothing is physically deleted and
  edit histories survive. **Mid-generation edits are protected:** the refresh
  captures the category `revision` before generating; if an edit/removal/
  restore lands while the model runs, activation refuses with 409
  `category_revision_conflict` and the newer manual work stays untouched.
- **Refresh all** (`POST /api/idea-engine/refresh-all`, `{confirm:true}`) —
  starts an in-process background job that runs the 12 categories
  **sequentially** (one local GPU) with a **per-category transactional
  strategy**: each category validates and activates independently and
  atomically, a failure affects only that category, and the job reports
  per-category success/failure. Global success is never claimed on a partial
  result. Progress: `GET /api/idea-engine/refresh-status` (the GUI polls it and
  resumes polling after a page reload). One job at a time (409 on duplicates).

## Promotion into Super Focus

`POST /api/idea-engine/promote` `{idea_id}`:

1. Validates the idea id; 404 unknown, 400 malformed. Only ACTIVE topics (or
   already-promoted ones opened from history) can be promoted — a removed
   unpromoted topic returns 409 `idea_not_active` (restore it first).
2. **Already promoted + project still exists → opens the existing project**
   (`already_promoted: true`), never creates a second one. (If the recorded
   project was deleted in Super Focus, a fresh promotion creates a new one.)
3. **Crash recovery (one-project invariant):** if the promotion record is
   missing but a project carrying this idea id in its origin sidecar exists
   (active or archived), the route reconciles the Idea Engine record and
   returns the existing project (`reconciled: true`) instead of creating a
   duplicate. The sidecar — written immediately after project creation — is
   the durable origin key; it survives Idea Engine edits and removals because
   it is keyed by the immutable idea id. The residual window is one write
   wide (crash between project creation and sidecar write).
4. Otherwise creates **exactly one** project via `superFocus.createProject`
   — the same canonical domain function the Super Focus GUI uses. The
   CURRENT content transfers (manual edits included: title = current title).
5. Writes the provenance sidecar `idea-engine-origin.json` (schema_version 2)
   into the project dir: idea id, batch id, model, category, the full content
   transferred at promotion time, `content_origin`, `edit_revision`,
   `original_generated_content` (the pre-edit model version, when edited),
   `replacement_for_idea_id`, promoted_at — the `super-focus.json` schema
   itself is not modified (precedent: aigen's `promoted-from-idea.json`).
6. Records the result on the idea: success → `promoted` + `project_id` +
   `promoted_revision`; failure → `failed` + error, never falsely `promoted`.
7. Returns `project_id` and an `href` to `super-focus.html?project=<id>`.
8. **Editing after promotion** changes only the Idea Engine record; the GUI
   flags "edited after promotion" (edit_revision > promoted_revision) and
   never rewrites the project. **Removing after promotion** hides the topic
   from active suggestions only; the project, its provenance, and the Open in
   Super Focus action remain (available from the removed-topics history).
9. **Never** starts image generation, video generation, PRESTO, or any other
   downstream action — the promote path performs no model call and no lane
   dispatch (guarded by tests). A per-idea mutation lock plus client-side
   guard prevents rapid double-click duplication.

## API inventory

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/idea-engine/state` | full view: categories + ideas + refresh status |
| GET | `/api/idea-engine/categories` | category definitions |
| GET | `/api/idea-engine/category?id=` | one category + its ideas |
| GET | `/api/idea-engine/idea?id=` | one idea |
| GET | `/api/idea-engine/refresh-status` | refresh-all job progress + locks |
| GET | `/api/idea-engine/removed?category_id=` | one category's removed-topics history |
| POST | `/api/idea-engine/refresh-category` | replace one category (confirm required) |
| POST | `/api/idea-engine/refresh-all` | start the sequential all-category job |
| POST | `/api/idea-engine/review` | mark an idea reviewed/opened |
| POST | `/api/idea-engine/edit` | edit one topic (expected_revision required) |
| POST | `/api/idea-engine/remove` | remove one topic to history (reason/note optional) |
| POST | `/api/idea-engine/restore` | restore a removed topic (capacity/dup guarded) |
| POST | `/api/idea-engine/replace-one` | generate exactly one replacement for a vacancy |
| POST | `/api/idea-engine/fill-vacancies` | fill all vacancies, one topic at a time |
| POST | `/api/idea-engine/promote` | promote one idea into Super Focus (idempotent) |

Concurrency rules: one mutation lock per idea (edit/remove/restore/promote
serialize; losers get 409), one generation lock per category (refresh /
replacement / fill), one refresh-all job at a time, per-idea `edit_revision`
checks against stale browser tabs, and per-category `revision` checks against
stale generation results. Locks are backed by server-side state — disabled
buttons are UX, never the protection.

All POSTs are nonce + local-Host + Origin gated (`validateLocalWriteRequest`)
with bounded bodies (16 KB); errors use the repo's `{ok:false, error, code}`
shape with the standard status codes (400/403/404/409/413/422/502/503/504).
Category and idea ids are strictly validated server-side; the browser never
supplies filesystem paths; model output never chooses ids or paths.

## GUI

`idea-engine.html` (cockpit archetype: shared `styles.css`, `ef-nav`, page
guide). Left: 12 categories with counts and status dots. Middle: the selected
category's 30 ideas (or cross-category search results) with New / Reviewed /
Promoted / Promotion-failed badges. Right: detail panel — category view
(description, relevance, batch info, refresh action) or idea view (all fields,
generation info, promote / open-in-Super-Focus). Opening an idea marks it
reviewed. Refreshes use a custom confirmation dialog (no native `confirm`);
buttons disable with `aria-busy` during operations; failures render with the
previous set intact; diagnostics live in a collapsed details block.

## Verify

```bash
cd /home/vidtoolz/vidtoolz-episode-factory
./scripts/verify.sh
```

Idea Engine tests: `tests/idea-engine.test.js` (domain, prompts, routes,
concurrency, security), `tests/idea-engine-phase2.test.js` (editing, removal,
restore, replacement, vacancy fills, refresh/edit conflicts, legacy-state
migration, promotion crash recovery), and `tests/idea-engine-ui.test.js`
(GUI logic + page wiring) — all model output via fixtures. Manual smoke: open
`idea-engine.html`, refresh one category, edit a topic and reload, remove a
topic with a reason, restore it, remove again and Generate replacement,
promote a disposable idea, confirm exactly one Super Focus project appears
and opens via the returned link, then archive/delete the disposable project
in Super Focus.

## Boundaries and known limitations

- Generation quality depends on the local model; a category refresh takes
  minutes on the local default model (a single replacement is much faster). The refresh-one
  / replace-one / fill-vacancies HTTP requests stay open for the duration
  (local-only, matching the existing generate routes).
- Exclusion lists sent to the model are capped (200 titles), so with a full
  360-idea estate the *prompt-side* discouragement is partial — the
  *validator-side* duplicate rejection always sees everything. Titles the
  model already had rejected within the current run are echoed back in later
  chunk prompts ("JUST REJECTED") so it stops resubmitting burned favourites.
- The refresh-all job is in-memory: a server restart mid-job loses the job
  record (not the per-category transactional state; finished categories stay
  activated, unfinished ones keep their previous sets).
- Promotion crash recovery is sidecar-based; the residual unrecoverable window
  is a crash between `createProject` and the sidecar write (one write wide).
  Retrying inside that window could create a second project.
- Removed-topic history and refresh-superseded archives grow without bound by
  design (nothing is physically deleted); with heavy long-term use the state
  file grows accordingly.
- Near-duplicate detection is deterministic token-overlap (Jaccard 0.8 on
  titles); it catches renames and cosmetic variants, not deep semantic
  duplicates with disjoint vocabulary.
- No evaluator scoring is applied (the Idea Module's evaluator is advisory and
  bound to its own store); human review + promotion remains the decisive gate.
