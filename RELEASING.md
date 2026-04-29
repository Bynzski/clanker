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

A full release produces both the Linux AppImage and the Windows NSIS installer + portable executable. Each platform must be built on its own host: the AppImage on Linux, the NSIS/portable on Windows. There is no cross-compilation step.

### 1. Prepare the release commit (Linux host)

1. Confirm `main` is green: `npm run validate` (lint, typecheck, security audit, build, tests). CI must be green for both `ubuntu-latest` and `windows-latest`.
2. Edit `CHANGELOG.md`: rename the `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD`. Add a fresh empty `## [Unreleased]` section above it. Update the link references at the bottom.
3. Bump `version` in `package.json` to `X.Y.Z`. Update `package-lock.json` to match (the top-level `version` and the root package entry).
4. Run `npm run validate` again.
5. Commit the changelog and version bump together: `chore(release): vX.Y.Z`.
6. Tag the commit: `git tag -a vX.Y.Z -m "Clanker Grid X.Y.Z"`.
7. Push: `git push origin main && git push origin vX.Y.Z`.

### 2. Build the Linux artifact (Linux host)

1. Run `npm run build:dist`. The AppImage lands in `release/Clanker Grid-X.Y.Z.AppImage`.
2. Smoke-test the AppImage on a clean/current Linux desktop: launch it, open a workspace, spawn a terminal, run a git operation, open the file explorer. If it does not launch, do not release.

### 3. Build the Windows artifacts (Windows host)

1. Check out the same `vX.Y.Z` tag on a Windows 10/11 machine with Git for Windows, Node.js 22+, and npm 10+ installed.
2. Run `npm ci`. `electron-builder` triggers `@electron/rebuild` for `node-pty` against the Electron ABI on first install.
3. Run `npm run build:dist`. Two artifacts land in `release/`:
   - `Clanker Grid Setup X.Y.Z.exe` — NSIS installer
   - `Clanker Grid X.Y.Z.exe` — portable executable
4. Smoke-test the NSIS installer on a clean Windows 10 or 11 VM: install, launch (accept the SmartScreen "Run anyway" prompt — the build is unsigned), open a workspace, spawn a PowerShell terminal, run a git operation, generate or load a credential, then uninstall and confirm `%APPDATA%\Clanker Grid` either persists or is cleared as intended.
5. Smoke-test the portable executable on a clean Windows VM: launch directly without installing, repeat the workspace + terminal + git smoke.

### 4. Publish the release

Once all artifacts are built and smoke-tested, attach them to a single GitHub release.

```
gh release create vX.Y.Z \
  'release/Clanker Grid-X.Y.Z.AppImage' \
  'release/Clanker Grid Setup X.Y.Z.exe' \
  'release/Clanker Grid X.Y.Z.exe' \
  --title "vX.Y.Z" \
  --notes "$(awk '/^## \[X.Y.Z\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)"
```

If the Linux and Windows hosts are different machines, copy the Windows artifacts back to the Linux host before running `gh release create`, or run `gh release upload vX.Y.Z` from each host in turn.

Mention the SmartScreen warning explicitly in the GitHub release notes so first-time Windows users know to expect it.

## Platform targets

This release ships:

- **Linux AppImage** (x64) — produced on Linux.
- **Windows NSIS installer** (x64, unsigned) — produced on Windows 10/11.
- **Windows portable executable** (x64, unsigned) — produced on Windows 10/11.

Not currently produced or supported:

- macOS (`dmg`, `zip`) — target definitions exist in `package.json` `build` but are not built or tested.
- ARM64 (Windows or Linux) — not built.
- WSL — not a target. WSL users should run the Linux AppImage.

Code signing for the Windows artifacts is planned for a follow-up release; the current NSIS and portable builds are unsigned and will trigger SmartScreen on first launch.

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
