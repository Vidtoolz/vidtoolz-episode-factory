# Release Checklist

Use this checklist before tagging or publishing a release.

## 1. Verify The Build

- Run the full automated verification:

```sh
./scripts/verify.sh
```

- Run the manual smoke test in [docs/smoke-test.md](smoke-test.md).
- Confirm the UI shows the intended version.

## 2. Back Up Local Data

- Open the app in the browser profile that contains the real working data.
- Click `Export JSON`.
- Store the exported file outside the browser profile.
- Reopen the file and confirm it contains an `episodes` array.

## 3. Review Release Scope

- Confirm no backend, API integration, drag-and-drop, or unrelated workflow work slipped into the release.
- Confirm JSON import/export behavior still matches [docs/data-model.md](data-model.md).
- Confirm known limitations are current in [docs/known-limitations.md](known-limitations.md).
- Confirm [CHANGELOG.md](../CHANGELOG.md) includes the release.

## 4. Git And Tagging

- Inspect changes:

```sh
git status --short
git diff --stat
```

- Commit with a release-focused message.
- Tag the release:

```sh
git tag v1.2.0
```

- Push the branch and tag when ready:

```sh
git push
git push origin v1.2.0
```

## 5. GitHub Publishing

- Open or update the GitHub release from tag `v1.2.0`.
- Include the changelog summary.
- Mention that data is browser-local and users should export JSON backups.
- Link the smoke test and known limitations docs.
