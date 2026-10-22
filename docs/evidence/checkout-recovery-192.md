# Main-checkout recovery verification (#192)

## Verdict

On source baseline `5774c3c`, the known Claude temporary-directory → stale
unregistered-location sequence recovers correctly with the fixes already merged
in #211. No product-code change was needed in this verification. Recommend closing
#192 as addressed by those fixes plus this regression evidence, with a new bounded
capture if the symptom recurs. This does **not** establish the exact cause of the
original screenshot-only incident.

## Environment and isolation

- Linux, Electron 41.10.7, installed Claude Code 2.1.304, Node 26.11.1.
- Freshly built main/renderer, real Electron, native Claude/Bash/Git and normal
  New Agent → PTY → attention hooks → IPC → renderer selection/polling.
- Disposable HOME, XDG directories, app profile and two committed fixture repos.
  Loopback model responses drive actual Bash tools; no paid inference or user
  conversation, repository, profile or worktree changes.
- Native Claude runs in stream-JSON print mode. A fixture-only `cat` pipe makes its
  stdin non-TTY: direct print-mode PTY input exits before accepting a prompt.
  This was a smoke-harness problem, not a reproduced product defect.
- The pre-existing untracked `scripts/claude-checkout-electron-smoke.cjs` was
  preserved unchanged. The repeatable check is the separate
  `scripts/claude-checkout-recovery-smoke.cjs`.

## Verified behavior

| Check | Result |
| --- | --- |
| Main `git worktree list`, `git branch --list`, `pwd` | Main selection/Git remain authorized. |
| Actual Bash `cd` to external temporary directory | Native `CwdChanged` produces an unregistered observation; renderer selection becomes unavailable. No extra context is registered. |
| Switch to another workspace and return during that excursion | Unavailable state is retained truthfully; no silent main-root fallback. |
| Finish that native turn | Root `Stop.cwd` restores current main-context observation, renderer selection and main-process Git polling. |
| Lifecycle semantics | Stop stays provisional; `lastCompletion` remains null. |
| Explorer | The committed fixture file is visible before the excursion and after recovery. |
| Main-root Git command on a subsequent turn | Selection and polling stay coherent. |
| Terminal refocus after recovery | Main remains available. |
| Normal app close/reopen after recovery | Saved project workspace restores main selection and Git branch/polling. Fixture PTYs are deliberately retired first; this is not native conversation resume. |
| Launch identity | Original terminal checkout-context ID remains unchanged throughout the live test. |

The broader built-Electron presentation smoke also passes: main plus two linked
worktrees, two-agent focus, dirty decorations/counts, last-known reacquisition,
historical agreement/disagreement, explicit main launch while another observation
is unregistered, and retirement. Its location reports are authenticated fixtures,
**not** native harness cwd movement.

## Regression commands

```bash
npm run build
npm run smoke:attention:claude-checkout
npm run smoke:attention:claude-checkout-electron
npm run smoke:checkout-presentation
npm run test -- tests/main/unit/attentionProviderLifecycle.test.ts tests/main/unit/agentAttentionBroker.test.ts tests/main/unit/observedWorktreeIpc.test.ts tests/main/integration/observedWorktree.real.test.ts tests/renderer/unit/checkoutSelection.test.ts tests/renderer/unit/checkoutReconciliation.test.tsx tests/renderer/unit/ObservedWorktreeNotice.test.tsx tests/renderer/integration/observedCheckoutPresentation.test.tsx
npm run validate
```

The focused suite passed **8 files / 220 tests**, including root Stop recovery,
child/stale event rejection, real-Git observed-worktree validation and registration,
late focus/selection results, and historical/unregistered observation handling.
Native CLI and both built-Electron smokes passed. The full Vitest run passed
**423 files / 8,135 tests**. Build passed separately.

### Initial validation blockers (before #222)

At the initial #192 verification, `npm run validate` was **not green**:

- The preserved pre-existing untracked smoke has an unused `document` global, so
  ordinary working-tree lint fails on that unrelated file. It was temporarily
  moved aside for an isolated validation attempt and restored byte-for-byte.
- With that file excluded, branding, lint, typecheck and both Fallow checks pass,
  but `security-check` stops the pipeline: npm reports **13 vulnerabilities
  (12 moderate, 1 high)**, including the installed Vite range. No dependency or
  lockfile changes, advisory exceptions or audit bypasses were applied.
- Build and the full test suite were therefore run independently. The dependency
  security gate was a separate blocker to merging this verification work.

Subsequent [#222 remediation](vite-security-222.md) updates Vite to 8.1.6 and
passes the security gate and full validation (423 files / 8,135 tests), with only
the unrelated untracked smoke temporarily moved aside and restored unchanged.
Both built-Electron checkout smokes also pass after the clean dependency install.
Ordinary lint of the restored entire working tree still fails on that independent
untracked file; no lint rules or audit gates were relaxed.

## Limits and recurrence capture

This is unpackaged headless Electron and native print-mode Claude with deterministic
responses, not a packaged AppImage, interactive TUI, real inference, live SSH,
Windows, every harness version, or recovery of the original running conversation.
No original private incident dump or event trace was available to establish its
precise root cause. Native worktree Enter/Exit and explicit attachment have focused
fixture coverage; they were not exercised as live native TUI actions here.

If the issue recurs, retain the build SHA, installed Claude version, approximate UTC
time and bounded sanitized checkout-observation/selection diagnostics: launch
context/root, observed context/root, provenance, accepted event ordering, workspace
identity and registration state. Do not substitute visible shell text for authority,
attach raw private logs, or loosen the external-location boundary.
