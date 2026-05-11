# Package Run Script Structure

`scripts/package-run-script-structure.js` creates the standalone
`script-structure.md` gate artifact for a package run.

Run it after `research-pack.md` exists:

```sh
node scripts/package-run-script-structure.js package-runs/YYYY-MM-DD-topic-slug
```

The tool only writes `script-structure.md`. It does not create
`script-prompt.md`, `script-draft.md`, `final-script.md`, or
`production-notes.md`.

The generated artifact is a first-pass structure scaffold, not just a warning.
It includes the package promise, target viewer, viewer problem, central thesis,
proof ladder, cold open, act structure, beat-by-beat outline, required examples,
viewer objections, retention risks, unsupported claims, and script-readiness
gate.

Existing `script-structure.md` files are preserved by default. Use
`--overwrite` only when intentionally replacing the structure artifact:

```sh
node scripts/package-run-script-structure.js package-runs/YYYY-MM-DD-topic-slug --overwrite
```

The tool reads the `Research Sufficiency Gate` inside `research-pack.md`:

- `Status: PASS` or `Manual approval: PASS` can mark `READY TO DRAFT`.
- `Status: PARTIAL` marks `PARTIAL` and `Ready to draft: no`.
- `Status: BLOCKED`, missing, or unreadable research marks `NEEDS RESEARCH`.

Missing fields are written as `Not specified yet.` The tool must not invent
sources, proof, examples, or approval.

`package-engine-new-script.js` may also create `script-structure.md` as a
convenience during script prep, but this standalone tool is the primary way to
review the script-structure boundary before drafting.
