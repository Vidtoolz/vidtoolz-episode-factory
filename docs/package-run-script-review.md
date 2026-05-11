# Package Run Script Review

`scripts/package-run-script-review.js` creates a local script review and
revision plan before production planning.

Run it after a script draft or final script exists:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug
```

To regenerate only `script-revision-plan.md` from an existing
`script-review.md`, use:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-topic-slug --from-review
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
- the script still contains deterministic unfinished markers such as `TODO`,
  `TBD`, `placeholder`, `Not drafted yet`, or an explicit unsupported-claim
  note
- the script uses strong claim language such as `guaranteed`, `proven`,
  `always`, `never`, `best`, or `only` without nearby proof/source language

`PASS` requires a script, approved research, ready script structure, and no
Creator QA blocker. `Production planning ready` is `yes` only when the review
status is `PASS`.

## Review -> Repair -> Approval Loop

1. Run the review tool after `script-draft.md` or `final-script.md` exists.
2. Read `script-review.md` for the pass/block status and deterministic issues.
3. Use `script-revision-plan.md` as the manual repair checklist.
4. Revise the script manually. The tool does not rewrite the script.
5. Re-run the tool with `--overwrite` only when intentionally replacing the
   previous generated review artifacts.
6. Move to production planning only when `Script review status: PASS` and
   `Production planning ready: yes`.

Creator QA remains separate. This tool reads local Creator QA report status
when present and treats blocking Creator QA statuses as review blockers; it does
not replace `scripts/package-run-creator-qa.js`.
