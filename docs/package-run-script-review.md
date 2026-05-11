# Package Run Script Review

`scripts/package-run-script-review.js` creates a local script review and
revision plan before production planning.

Run it after a script draft or final script exists:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug
```

The tool writes exactly:

- `script-review.md`
- `script-revision-plan.md`

It does not create production prep, shooting plans, b-roll lists, graphics
lists, or publish packs.

Existing review files are preserved by default. Use `--overwrite` only when
intentionally replacing them:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
```

The review is conservative. It will not pass if:

- no `final-script.md` or `script-draft.md` exists
- `research-pack.md` is missing, `PARTIAL`, or `BLOCKED`
- `script-structure.md` says `Ready to draft: no`
- Creator QA has a blocking status such as `FAIL`, `NEEDS WORK`, or
  `REVIEW REQUIRED`

`PASS` requires a script, approved research, ready script structure, and no
Creator QA blocker. `Production planning ready` is `yes` only when the review
status is `PASS`.
