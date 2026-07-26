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
  `think:false`), model `IDEA_ENGINE_OLLAMA_MODEL` → `OLLAMA_MODEL` → `qwen3:14b`

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
requested, accepted, duration_ms, chunks, rejected_candidates), `ideas[30]`,
`last_failure`, `promoted_history[]`.
Each idea: `id` (`ie-<8hex>`, always server-generated — model ids are never
trusted), `category_id`, `title`, `premise`, `why_vidtoolz`, `why_short`,
`tension`, `hook?`, `status` (`generated` | `reviewed`), `reviewed_at`,
`created_at`, `batch_id`, `promotion` (`state`: `none` | `promoted` | `failed`,
`project_id`, `promoted_at`, `error`).

Schema evolution: `loadState`/`loadCategories` normalize missing fields
(mirrors `super-focus.js readStateDir`), so adding fields never breaks stored
sets. All writes are atomic (tmp + rename). Corrupt JSON surfaces as 422.

## Generation flow

1. Prompts come from `idea-engine-prompts.js`: doctrine-grounded system prompt
   (blunt production realist, 2:15–2:50 miniature evergreen explainer, 18-month
   durability test, misconception-first shape) + category guidance + exclusion
   list + strict JSON schema, returned as one `{system, user, schema}` unit.
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
  explicit confirm flag (the GUI collects it in a custom dialog); 409
  `generation_in_progress` if that category or a refresh-all is running.
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

1. Validates the idea id; 404 unknown, 400 malformed.
2. **Already promoted + project still exists → opens the existing project**
   (`already_promoted: true`), never creates a second one. (If the recorded
   project was deleted in Super Focus, a fresh promotion creates a new one.)
3. Otherwise creates **exactly one** project via `superFocus.createProject`
   — the same canonical domain function the Super Focus GUI uses (title =
   idea title; slug/id/collision rules unchanged).
4. Writes a provenance sidecar `idea-engine-origin.json` into the project dir
   (idea id, batch id, category, premise, relevance, suitability, tension,
   hook, promoted_at) — the `super-focus.json` schema itself is not modified
   (precedent: aigen's `promoted-from-idea.json`).
5. Records the result on the idea: success → `promoted` + `project_id`;
   failure → `failed` + error, never falsely `promoted`.
6. Returns `project_id` and an `href` to `super-focus.html?project=<id>` (a
   deep link added for this flow, mirroring the `?focus=` precedent).
7. **Never** starts image generation, video generation, PRESTO, or any other
   downstream action — the promote path performs no model call and no lane
   dispatch (guarded by tests). A per-idea in-flight lock plus client-side
   guard prevents rapid double-click duplication.

## API inventory

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/idea-engine/state` | full view: categories + ideas + refresh status |
| GET | `/api/idea-engine/categories` | category definitions |
| GET | `/api/idea-engine/category?id=` | one category + its ideas |
| GET | `/api/idea-engine/idea?id=` | one idea |
| GET | `/api/idea-engine/refresh-status` | refresh-all job progress + locks |
| POST | `/api/idea-engine/refresh-category` | replace one category (confirm required) |
| POST | `/api/idea-engine/refresh-all` | start the sequential all-category job |
| POST | `/api/idea-engine/review` | mark an idea reviewed/opened |
| POST | `/api/idea-engine/promote` | promote one idea into Super Focus |

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
concurrency, security — all model output via fixtures) and
`tests/idea-engine-ui.test.js` (GUI logic + page wiring). Manual smoke: open
`idea-engine.html`, refresh one category, open a sub-topic, promote a
disposable idea, confirm exactly one Super Focus project appears and opens via
the returned link, then archive/delete the disposable project in Super Focus.

## Boundaries and known limitations

- Generation quality depends on the local model; a category refresh takes
  minutes on `qwen3:14b`. The refresh-one HTTP request stays open for the
  duration (local-only, matching the existing generate routes).
- Exclusion lists sent to the model are capped (120 titles), so with a full
  360-idea estate the *prompt-side* discouragement is partial — the
  *validator-side* duplicate rejection always sees everything.
- The refresh-all job is in-memory: a server restart mid-job loses the job
  record (not the per-category transactional state; finished categories stay
  activated, unfinished ones keep their previous sets).
- If a promotion crashes between project creation and state write, the idea
  can show unpromoted while the project exists; re-promoting would create a
  second project. The window is one atomic write wide.
- No evaluator scoring is applied (the Idea Module's evaluator is advisory and
  bound to its own store); human review + promotion remains the decisive gate.
