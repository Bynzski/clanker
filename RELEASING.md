# Releasing

This document defines how releases of Clanker Grid are produced. It is the source of truth — if reality drifts from this file, update the file.

## Versioning

Clanker Grid follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** — incompatible change to user-visible behavior, the IPC contract, or stored data shapes.
- **MINOR** — backwards-compatible new feature.
- **PATCH** — backwards-compatible bug fix only.

While the project is pre-1.0, MINOR releases may break compatibility. When they do, the break must be called out explicitly in the changelog under a `### Changed` or `### Removed` section.

## Changelog discipline

- The changelog format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- Every pull request that changes user-visible behavior adds an entry under the `## [Unreleased]` heading in `CHANGELOG.md`. Pure refactors, internal-only changes, test-only changes, CI changes, and documentation-only changes do not require a changelog entry.
- Sections, in order: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Omit sections with no entries.
- Entries describe behavior, not implementation. They are short and factual.
- If you cannot verify an entry from the code or the running app, leave it out. Omitting is preferred over guessing.

## Release process

Releases are cut from `main`. The working tree must be clean before starting.

1. Confirm `main` is green: `npm run validate` (lint, typecheck, security audit, build, tests).
2. Edit `CHANGELOG.md`: rename the `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD`. Add a fresh empty `## [Unreleased]` section above it. Update the link references at the bottom.
3. Bump `version` in `package.json` to `X.Y.Z`.
4. Run `npm run validate` again.
5. Run `npm run build:dist`. The AppImage lands in `release/Clanker Grid-X.Y.Z.AppImage`.
6. Smoke-test the AppImage: launch it, open a workspace, spawn a terminal, run a git operation. If it does not launch, do not release.
7. Commit the changelog and version bump together: `chore(release): v0.1.0`.
8. Tag the commit: `git tag -a vX.Y.Z -m "Clanker Grid X.Y.Z"`.
9. Push: `git push origin main && git push origin vX.Y.Z`.
10. Create the GitHub release and attach the AppImage:

    ```
    gh release create vX.Y.Z 'release/Clanker Grid-X.Y.Z.AppImage' \
      --title "vX.Y.Z" \
      --notes "$(awk '/^## \[X.Y.Z\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)"
    ```

## Platform targets

This release ships **Linux AppImage (x64) only**.

The `build` block in `package.json` carries macOS (`dmg`, `zip`) and Windows (`nsis`, `portable`) target definitions, but those targets are not produced or tested as part of the release flow and require building on the respective platform. Adding a platform to the supported set means producing it, smoke-testing it, attaching it to the release, and updating this document.

## Hotfix releases

For a critical fix against the latest release:

1. Branch from the release tag: `git checkout -b hotfix/X.Y.(Z+1) vX.Y.Z`.
2. Land the fix on that branch with the changelog entry under `## [Unreleased]`.
3. Follow the standard release process with a PATCH bump.
4. Merge the hotfix branch back into `main`.

## What does not belong in a release

- Uncommitted changes.
- Local config (`.codex`, editor state, environment files).
- Anything in `release/`, `dist/`, `build/`, or `coverage/` — these are gitignored by design.
- Changelog entries for behavior that is not in the tagged commit.
