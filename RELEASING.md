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

Linux is the primary validation platform. Windows remains best-effort supported; native Windows CI or smoke testing is not an automatic release gate. Preserve Windows packaging and compatibility tests. Maintainers may still delay a release for a concrete severe Windows regression.

Releases are cut from `main`. The working tree must be clean before starting.

A full release produces both the Linux AppImage and the Windows NSIS installer + portable executable. Each platform must be built on its own host: the AppImage on Linux, the NSIS/portable on Windows. There is no cross-compilation step.

Linux-only releases are allowed at any semantic version when the artifact scope is explicit. Choose the version from the changes being released, complete Linux validation and the AppImage smoke test, mention the Linux-only artifact scope in `CHANGELOG.md`, and publish only the AppImage. The release commit must pass the CI `validate` check (canonical Ubuntu validation); a Windows artifact is not required for a Linux-only release.

### 1. Prepare the release commit (Linux host)

1. Confirm `main` is green: run `npm ci`, then `npm run validate` (branding check, lint, typecheck, security check, build, tests). The CI `validate` check must be green; it requires Ubuntu validation (lint, typecheck, build, full tests with coverage, including Windows simulation tests). See [Security gate](#security-gate) for what the security check enforces.
2. Edit `CHANGELOG.md`: rename the `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD`. Add a fresh empty `## [Unreleased]` section above it. Update the link references at the bottom.
3. Bump `version` in `package.json` to `X.Y.Z`. Update `package-lock.json` to match (the top-level `version` and the root package entry).
4. Run `npm run validate` again.
5. Commit the changelog and version bump together: `chore(release): vX.Y.Z`.
6. Push the release commit to `main` and wait for the CI `validate` check on that commit to pass. Do not create or push the version tag yet.

### 2. Build the Linux artifact (Linux host)

1. Run `npm run build:dist -- --linux AppImage --x64` to select only the Linux x64 target explicitly. The AppImage lands in `release/Clanker Grid-X.Y.Z.AppImage`; the `build:dist` script disables electron-builder publishing, so this step creates only a local artifact.
2. Smoke-test the AppImage on a clean/current Linux desktop: launch it, open a workspace, spawn a terminal, run a git operation, open the file explorer. If it does not launch, do not release.

### 3. Build the Windows artifacts (Windows host, full releases only)

1. Check out the release commit from `main` on a Windows 10/11 machine with Git for Windows, Node.js 22+, and npm 10+ installed.
2. Run `npm ci`. During the packaging step below, `electron-builder` triggers `@electron/rebuild` for `node-pty` against the Electron ABI.
3. Run `npm run build:dist`. Two artifacts land in `release/`:
   - `Clanker Grid Setup X.Y.Z.exe` — NSIS installer
   - `Clanker Grid X.Y.Z.exe` — portable executable
4. Smoke-test the NSIS installer on a clean Windows 10 or 11 VM: install, launch (accept the SmartScreen "Run anyway" prompt — the build is unsigned), open a workspace, spawn a PowerShell terminal, run a git operation, generate or load a credential, then uninstall and confirm `%APPDATA%\Clanker Grid` either persists or is cleared as intended.
5. Smoke-test the portable executable on a clean Windows VM: launch directly without installing, repeat the workspace + terminal + git smoke.

### 4. Publish the release

Once all planned artifacts are built and smoke-tested, confirm the working tree is clean, tag the release commit, and push the tag:

```bash
git tag -a vX.Y.Z -m "Clanker Grid X.Y.Z"
git push origin vX.Y.Z
```

Attach all planned artifacts to a single GitHub release. Replace `X.Y.Z` in the commands below with the actual version. Extract the release notes from the prepared changelog before publishing:

```bash
awk -v version="X.Y.Z" 'index($0, "## [" version "] - ") == 1 {flag=1;next} /^## \[/ {flag=0} flag' CHANGELOG.md > release/release-notes.md
```

Review that file, including the artifact scope. For a full release:

```
gh release create vX.Y.Z \
  'release/Clanker Grid-X.Y.Z.AppImage' \
  'release/Clanker Grid Setup X.Y.Z.exe' \
  'release/Clanker Grid X.Y.Z.exe' \
  --title "vX.Y.Z" \
  --notes-file release/release-notes.md
```

If the Linux and Windows hosts are different machines, copy the Windows artifacts back to the Linux host before running `gh release create`, or run `gh release upload vX.Y.Z` from each host in turn.

Mention the SmartScreen warning explicitly in the GitHub release notes so first-time Windows users know to expect it.

For a Linux-only release, publish only the AppImage:

```bash
gh release create vX.Y.Z \
  'release/Clanker Grid-X.Y.Z.AppImage' \
  --title "vX.Y.Z" \
  --notes-file release/release-notes.md
```

Mention in the release notes that no Windows build was produced for this tag.

## Security gate

`npm run security-check` runs `scripts/security-audit.cjs`, which runs `npm audit --json` and fails on any high or critical finding, or if `npm audit` cannot produce a report. Development and packaging dependencies are included: build tooling produces the release artifacts. CI uploads a raw `npm audit` report as an informational artifact; the gate itself runs locally through `npm run validate`.

**Temporary exception.** `GHSA-ch52-4w7c-c8xp` (`http-cache-semantics` <= 4.2.0, max-stale cache handling) has no patched release. Every current `electron-builder` v26 release (checked through 26.17.0) reaches it through `app-builder-lib` → `@electron/get@3` → `got@11` → `cacheable-request`, and npm's only suggested fix is a downgrade to `electron-builder@26.5.0`. The script permits exactly this advisory in exactly this chain, and only while every affected package is a dev-only entry in `package-lock.json` and `electron-builder` is a devDependency. Any other advisory, or the same advisory in a runtime dependency, fails the check. Clanker does not ship these packages; they run on the release host, where `@electron/get` downloads toolchain and Electron binaries without enabling an HTTP cache.

**Do not downgrade to clear the audit.** The script always requires `app-builder-lib` and `electron-builder` >= 26.15.0 (fixes `GHSA-7g7r-gx96-252g`, an AppImage vulnerability; Clanker ships an AppImage) and `builder-util-runtime` >= 9.7.0 (fixes `GHSA-p2f4-r6v6-j797`).

**Removal.** When an `electron-builder` release stops depending on a vulnerable `http-cache-semantics` chain (for example by moving to `@electron/get` >= 4 without `got`), upgrade, then replace the script with `npm audit --audit-level=high` in `package.json`'s `security-check` and delete the script and its test. The script prints a notice when the exception is no longer needed.

## Platform targets

A full release ships:

- **Linux AppImage** (x64) — produced on Linux.
- **Windows NSIS installer** (x64, unsigned) — produced on Windows 10/11.
- **Windows portable executable** (x64, unsigned) — produced on Windows 10/11.

A Linux-only release ships:

- **Linux AppImage** (x64) — produced on Linux.

Not currently produced or supported:

- macOS (`dmg`, `zip`) — target definitions exist in `package.json` `build` but are not built or tested.
- ARM64 (Windows or Linux) — not built.
- WSL — not a target. WSL users should run the Linux AppImage.

Code signing for Windows artifacts is planned for a follow-up release; current NSIS and portable builds are unsigned and will trigger SmartScreen on first launch when they are produced.

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
