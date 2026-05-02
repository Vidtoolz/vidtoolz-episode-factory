# Creator QA Export

Episode Factory can export the selected episode in two Creator QA compatible formats:

- Creator QA JSON: for `creator-qa check-episode-json`.
- Creator QA Markdown Package: for `creator-qa check`.

These exports are local copy/download actions. They do not call Creator QA, Hermes, Linear, Codex, web services, LLMs, or external APIs.

## Creator QA JSON Fields

The selected episode maps to the Creator QA v0.5 JSON shape:

- `title`: Episode `workingTitle`, falling back to the first `titleOptions` line when needed.
- `thumbnailConcept`: Episode `thumbnailConcept`.
- `thumbnailText`: Empty string until Episode Factory has a dedicated thumbnail text field.
- `hook`: Episode `hook`.
- `promise`: Episode `corePromise`.
- `viewerPayoff`: Episode `corePromise`.
- `scriptOutline`: Episode `scriptOutline`.
- `script`: Empty string until Episode Factory stores a final script field.
- `notes`: Episode `notes`.
- `factualClaims`: Empty array until Episode Factory tracks factual claims separately.
- `sourceNotes`: Empty array until Episode Factory tracks source notes separately.
- `status`: Episode `status`.
- `packagingGate`: Packaging Gate checklist summary with passed count, total count, and item states.
- `checklist`: Flattened checklist lines across Packaging, Production, Editing, Shorts, and Publish groups.
- `shortsIdeas`: Lines parsed from the legacy `shortsPlan` field.
- `nextAction`: Episode Factory generated next action.

Every mapped field should remain documented here when the export shape changes.

## Creator QA Markdown Sections

The Markdown package uses:

```markdown
# Title
# Thumbnail
# Hook
# Viewer Payoff
# Script
# Factual Claims / Source Notes
# Resolve Terminology Used
# Notes
```

Fields that Episode Factory does not store yet are rendered as empty/default notes instead of throwing an error.

## Manual Creator QA Check

After exporting Creator QA JSON:

```bash
cd /home/vidtoolz/vidtoolz-creator-qa
source .venv/bin/activate
creator-qa check-episode-json /path/to/export.json --hermes-report
```

After exporting Creator QA Markdown:

```bash
cd /home/vidtoolz/vidtoolz-creator-qa
source .venv/bin/activate
creator-qa check /path/to/export.md --hermes-report
```

## Current Limits

- Episode Factory does not yet have dedicated fields for thumbnail text, final script, factual claims, source notes, or Resolve terminology.
- Creator QA may flag empty/default mapped fields as issues. That is expected and should be fixed in the episode package, not hidden by the export layer.
- Running Creator QA is still a manual command in v1.2; Episode Factory only prepares compatible files.
