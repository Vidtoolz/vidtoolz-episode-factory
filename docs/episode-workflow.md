# Episode Workflow

Episode Factory is designed for a solo YouTube creator who needs to move from rough idea to a shoot-ready and publish-ready package without adding project-management overhead.

## Intended Flow

1. Capture the rough topic in `Idea`.
2. Move to `Packaging` when the idea needs title, thumbnail, promise, and hook work.
3. Use the Packaging Gate before treating the package as ready.
4. Move to `Script` when the viewer problem, promise, title options, thumbnail concept, and hook are coherent.
5. Move to `Ready to Shoot` when the script outline and production checklist are usable.
6. Move to `Editing` when recording is done and editing work starts.
7. Move to `Ready to Publish` when the edit is complete and publish assets need final checks.
8. Move to `Published` after the video is live.
9. Move to `Archived` when the episode is no longer active but should remain available for reference.

## Detail Fields

- `Topic`: the plain subject of the episode.
- `Working title`: current best title.
- `Target viewer`: who the video is for.
- `Viewer problem`: the problem or friction the viewer feels.
- `Core promise`: what the viewer should get by watching.
- `Title options`: title candidates to compare.
- `Thumbnail concept`: simple visual promise for the thumbnail.
- `Hook`: first moments of the video.
- `Script outline`: beat-level structure.
- `Next action override`: optional manual override for the generated queue task.
- `Production checklist`: recording and asset capture tasks.
- `Editing checklist`: edit tasks.
- `Shorts extraction plan`: clips or ideas to pull from the main episode.
- `Publish checklist`: final upload checks.
- `Notes`: loose context, blockers, decisions, or next actions.

## Episode Package Export

The export buttons produce practical text artifacts for the selected episode:

- Full Episode Markdown Package: the canonical portable package. Use it as the inspectable artifact before handoff, review, or publishing.
- Hermes memory update: a compact state update for project memory and continuity.
- Linear issue body: a task-ready issue body with readiness scores and remaining checklist work.
- Production brief: the practical shoot/edit handoff for recording and editing sessions.
- YouTube publish package: title options, thumbnail concept, description draft, Shorts plan, and publish checklist.
- Codex follow-up task: a focused prompt for asking Codex to improve the next weakest part of the episode package.

Use the Markdown download when you want a durable file outside browser storage. Use copy buttons when moving the selected package into Hermes, Linear, Codex, or a YouTube upload prep note.

These are copy/download-only in v0.5. No external API calls are made.

## Execution Queue

The Execution Queue answers the work-session question: what should be done next?

It scans active episodes and generates one 30-minute task per episode when there is a useful blocker. The queue prioritizes packaging blockers first, then script gaps, shoot preparation, editing completion, and publish preparation.

Use the Human task package when sitting down to work. Use the Hermes package for memory/context updates, the Linear body when turning a task into an issue, and the Codex prompt when asking for focused help on the next blocker. These are copy-only text packages, not API integrations.

## Closing The Loop

After doing a queue task, use `Complete` on that task. Record:

- actual minutes spent
- what was completed
- what is still blocked
- notes
- next action
- checklist items that were actually completed

The app then stores a work session on the episode, updates the selected checklist items, and refreshes readiness and queue recommendations. This keeps planning, execution, and follow-up in one local record.

Recent sessions can be copied as:

- Hermes session update
- Linear progress comment
- Codex follow-up prompt
- Episode history markdown
