# Package Run Research Pack

`scripts/package-run-research-pack.js` creates a local `research-pack.md` for a
selected package run before outline or script work begins.

Run it after saving `selected-package.json` or `selected-package.md`:

```sh
node scripts/package-run-research-pack.js package-runs/YYYY-MM-DD-topic-slug
```

The tool is deterministic and local-first. It reads the selected package when
available, creates a structured Markdown starter pack, and does not call
external APIs, update Hermes brain, create Episode Factory episodes, or create
scheduled jobs.

The generated pack includes:

- video candidate / working title
- core claim
- target viewer
- viewer problem
- what must be proven
- known facts
- missing facts
- examples needed
- objections / counterarguments
- production-relevant evidence needed
- source list placeholder
- research sufficiency gate with `PASS`, `BLOCKED`, or `PARTIAL`

If expected package files are missing or unreadable, the command still creates
a useful starter template and marks the research sufficiency gate as `BLOCKED`.
If a selected package is readable but evidence has not been filled in, the gate
starts as `PARTIAL`.

Existing `research-pack.md` files are preserved by default. Use `--overwrite`
only when intentionally replacing a generated or reviewed pack:

```sh
node scripts/package-run-research-pack.js package-runs/YYYY-MM-DD-topic-slug --overwrite
```

`research-pack.md` existing only means the run has reached `Research pack
ready` as a file workflow state. It does not mean research is sufficient.

The standalone Script Structure tool writes `script-structure.md` and inspects
the `Research Sufficiency Gate` inside `research-pack.md`:

```sh
node scripts/package-run-script-structure.js package-runs/YYYY-MM-DD-topic-slug
```

- `Status: PASS` marks the script structure `READY TO DRAFT`.
- `Status: PARTIAL` marks the script structure `PARTIAL`.
- `Status: BLOCKED`, missing, or unreadable research marks it `NEEDS RESEARCH`.
- A manual approval marker such as `Manual approval: PASS` can also mark it
  `READY TO DRAFT`.

The default generated research pack starts as `PARTIAL` when a selected package
exists and `BLOCKED` when package context is missing.
