# Release baseline assessment — 2026-10-31

This is a preparation record, not release approval. The initial blockers below are
retained as dated evidence; see the dependency-remediation follow-up for current results. Source reviewed: `16fc0d3`
(main), 96 commits after the published `v0.12.0` tag. The proposed next baseline
is a Linux x64 release, provisionally `0.13.0` because it includes new features
and changed workflows. Keep the version and changelog under Unreleased until
the candidate is validated and its scope is settled.

## Merge decisions

GitHub's open-PR inventory contained only [#227](https://github.com/Bynzski/clanker/pull/227),
at `23e71f30a4f5276d50c442c90cf3fbed8d6667b3`: native Hermes Assistant attention.
Recommendation: defer from the baseline. It is a draft feature, not a fix required
to release main. Its documented validation lacks a real model-turn/native UI smoke,
and its security gate fails. Green GitHub checks currently omit that blocking gate.
Scope, observer/service wiring, UI projection and stated validation were reviewed;
this is not a full correctness approval of the PR. No PR was merged or closed.

Reconsider #227 after dependency remediation, current-base validation and native
evidence for root identity, human-input waits, disconnect/reconnect, and existing
keep-alive sessions without a sidecar. Do not add it merely to clear the PR queue.

## Release blockers and order

1. **Restore the CI contract.** This preparation patch adds branding and blocking
   security checks to Ubuntu CI, retains its audit artifact and coverage suite,
   and removes current-policy references to the retired advisory exception.
2. **Remediate dependencies in a focused change.** The current lockfile audit has
   four high-severity package findings: `body-parser` 2.3.0, Electron 41.10.7,
   `undici` 6.28.1 / 7.29.1, and `zod` 4.3.6. No exceptions are permitted.
   The audit's patched ranges point to body-parser >=2.4.0, undici >=6.29.1 /
   >=7.30.1, and zod >=4.6.6. Electron requires separate runtime selection and
   compatibility verification; the certificate advisory affects versions below
   42.11.16, beyond the pinned 41.x line. Recheck advisories when implementing;
   these are dated findings, not a perpetual safe-version list. Do not use forced
   audit fixes that downgrade electron-builder below the release-policy floor.
3. **Validate an exact clean candidate.** Run `npm ci` and `npm run validate`,
   then obtain green CI for the release commit. The preparation checkout shares
   installed dependencies with the launch checkout; that is not fresh-install
   release evidence. The original checkout's untracked
   `scripts/claude-checkout-electron-smoke.cjs` was preserved untouched; its unused
   `document` declaration blocks lint there and must be resolved separately if
   that checkout is used for release preparation.
4. **Package and smoke-test the candidate.** Build the Linux x64 AppImage and
   exercise launch/restart, workspace restoration, New Agent/main/worktree,
   terminal I/O, files/save, Git, Browser/local links, history and available
   Assistants. Verify native PTY rebuilding and Browser behavior after an Electron
   update. Check SSH behavior using the existing guarded procedure when a test
   host is available; record unavailable coverage explicitly. Existing source
   smokes and old screenshots do not certify the new AppImage.
5. **Finish release metadata and publish through RELEASING.md.** Review the
   Unreleased entries against merged behavior, declare Linux-only artifacts,
   record compatibility limitations, and tag only the smoke-tested source commit.

Security sources: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Electron certificates](https://github.com/advisories/GHSA-jr5w-w6x2-84p9),
[undici TLS validation](https://github.com/advisories/GHSA-2m5v-pch6-74hx),
[zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Documentation reconciliation

This pass compares the user guides and Unreleased section with merged changes and
implementation. It corrects Files resizing, registered observed-checkout selection,
explicit Attach and browse, Assistant session refresh and local Usage, and adds
missing release notes for browser search, observed attachment, crash recovery and
history refresh. The docs index now exposes observed-worktree and crash references.
Historical validation receipts retain their dates but identify the old audit
exception as retired. Local link-target checks found no missing files in the
top-level user/developer guides (excluding intentionally unsafe-link smoke fixtures).

The existing hotfix instructions still need a separate clarification: they branch
from a tag but refer back to a main-only release/CI flow. This does not block a
normal main-based baseline; do not silently relax exact-commit CI requirements
when implementing that later policy fix.

Remaining release review must assess settings/data compatibility across the chosen
baseline and older binaries. Retaining an old AppImage alone does not prove a safe
downgrade. Do not claim that a renderer reload preserves live PTYs or unsaved buffers.

## Open issues outside the merge queue

- [#196](https://github.com/Bynzski/clanker/issues/196): recovery and capture exist;
  the original native crash cause remains unresolved. Retain that limitation and
  test recovery on the new runtime. A reproduced severe candidate crash blocks
  release; closing the investigation is not evidence of a fix.
- [#182](https://github.com/Bynzski/clanker/issues/182): remaining SSH Assistant
  discovery/enrichment is follow-up scope. Current Assistants remain local-only.
- [#181](https://github.com/Bynzski/clanker/issues/181): native worktree research
  does not require redesigning the existing Git-first launch for this release.
- [#208](https://github.com/Bynzski/clanker/issues/208): defer nightly distribution
  and automatic installation until after the baseline. Continue integrating on
  main and use stable tags; no default-branch/protection migration is needed.

No version bump, tag, release publication, installer update or GitHub mutation was
performed in this preparation pass.

## Preparation validation

On the preparation branch with shared installed dependencies, lint, typecheck and
build passed; all 428 Vitest files / 8,255 tests passed. These checks do not replace
fresh-install, CI, security or packaged smoke evidence. Final `npm run validate`
passed branding, lint, typecheck and both Fallow checks, then failed at the security
gate with four high findings (36 total: 1 low, 31 moderate, 4 high). Its build and
test stages were not reached; the independent build/test run above passed. Workflow
YAML parses, both added checks are blocking, and `git diff --check` passes.


## Dependency remediation follow-up

The preparation branch now pins Electron 43.8.6 and resolves body-parser 2.4.0,
undici 6.29.1 / 7.30.1, zod 4.6.7 and its accompanying qs update to 6.17.1.
Only these six lockfile package entries changed. No overrides, audit exceptions,
forced fixes or packaging-tool downgrades were introduced. The prior shared
node_modules symlink was removed and `npm ci` installed this checkout independently.
The host used Node 26.12.1 / npm 12.2.1; CI's Node 22 run remains necessary.
The audit now reports zero high/critical findings (30 moderate, 1 low).

Electron 43 is the oldest major line in the current stable-update listing. Source
review of the [42/43 breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
identified lazy runtime download, native dialog default-directory changes and Linux
window-decoration changes. Existing explicit folder defaults and custom titlebar
controls remain; no sandbox or navigation-policy weakening was needed. Setup docs
now download the runtime explicitly and rebuild node-pty before development launch.
Typecheck/build and native node-pty rebuilding passed.

Verification on Electron 43.8.6:

- Real Browser file-link smoke passed, including popups, anchors, confinement and
  remote/iframe/redirect rejection.
- Source-built New Agent smoke passed. It now uses the existing bounded fixture
  cleanup helper instead of waiting indefinitely for Playwright close/stdio drain.
- Linux x64 AppImage packaging passed. The exact artifact is
  `Clanker Grid-0.12.0-dev.16fc0d3.baseline.AppImage`, SHA-256
  `9a9dbe6813f89321cfadd2e7ac15eef972f347941af4e587b9d5d280536c364f`.
  It includes uncommitted preparation changes, so its SHA-bearing name is not a
  claim that it was built from clean 16fc0d3. It is not a tagged release candidate.
- The same New Agent smoke passed against that actual AppImage (`app.isPackaged`
  asserted): workspace opening, real PTYs, project/existing/new worktree selection,
  branch operations, preservation of dirty work, restart/adoption, compact layout
  and 125% zoom. The compact 125% screenshot was visually inspected.
- Native X11 crash smoke passed: one deliberate fixture renderer crash, real Reload
  dialog, one restored shell and a 148,704-byte local minidump. This does not resolve
  the original #196 crash cause.
- Source Control's initial smoke exposed an immediate assertion after Unstage All
  before the operation's busy state cleared. A bounded existing `until` wait now
  waits for the refresh control to become enabled before checking commit actions.
  The rerun passed all three themes, compact/zoomed layouts, real staging/commits,
  linked-checkout operations and Browser suppression/restoration. Fixture PTY exit
  and clean Electron shutdown were verified; the Changes screenshot was inspected.

These are disposable-profile checks. Live SSH, native authenticated harnesses,
Windows, existing-user-data migration and a final clean release commit/AppImage
still require their scoped acceptance or an explicit coverage limitation. No user's
installed app, profile or launcher was replaced.

Final fresh-dependency `npm run validate` passed branding, lint, typecheck, both
Fallow gates, the no-high/critical security gate, build and all 428 test files /
8,255 tests. The remaining lower-severity audit findings are reported, not excepted.

The first Node 22 CI run passed all gates through build, but one test file failed
to load because parallel workers raced Electron 43 lazy runtime extraction
(`File exists`); 427 files / 8,139 tests passed. Test, watch and coverage commands
now run the shipped `install-electron` binary once before starting Vitest workers.
This addresses fresh-install ordering without changing the application or mocks.

With the downloaded Electron dist moved out of the checkout, the corrected final
`npm run validate` installed the runtime before workers and passed all gates and
428 files / 8,255 tests again.
