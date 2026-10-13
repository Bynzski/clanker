# Documentation

These guides document **current `main`**, including features not yet in a published build. They are not frozen to the last tag. [CHANGELOG.md](../CHANGELOG.md) records changes since the last published version under **Unreleased**; for a particular binary, check its [GitHub release](https://github.com/Bynzski/clanker/releases) and assets.

## User guides

- [Getting started](getting-started.md) — installation, empty workspace opening and restart behavior
- [Workspaces](workspaces.md) — navigation, New Agent, linked worktrees, SSH, history and previews
- [Workspace pages](workspace-pages.md) — page switching, pane moves, minimize/restore and persistence boundaries
- [Terminals and AI harnesses](terminals.md) — launch defaults, attention, history, usage and Hermes Assistants
- [Local dev servers](dev-services.md) — checkout-scoped Run, Install, Stop, Browser and diagnostics
- [Git integration](git-integration.md) — Source Control pages, staging/commits, remotes and protected worktrees
- [VCS providers](vcs-providers.md) — GitHub, GitLab and Bitbucket context
- [File explorer and editor](file-explorer.md) — checkout selection, pinned files and Markdown preview
- [Browser tabs](browser-tabs.md) and [annotation](browser-annotation.md)
- [Configuration](configuration.md) and [keyboard shortcuts](keyboard-shortcuts.md)
- [Windows notes](windows.md) — best-effort desktop compatibility and setup

## Developer references

- [Contributing](../CONTRIBUTING.md), [agent/architecture guidance](../AGENTS.md) and [releasing](../RELEASING.md)
- [Harness integration](harness-integration.md) — provider contracts, accounts, attention, read-only MCP and verification limits
- [Unified session launch](unified-session-launch.md) — current New Agent and worktree adoption contract
- [Attention field diagnostics](attention-field-diagnostics.md) — bounded development logging and evidence limitations
- [Workspace startup](workspace-startup.md) — persisted identities, empty shells and hydration
- [Recipes and native history](recipes.md) — explicit execution and conversation authority
- [History reliability](conversation-history-reliability.md) — freshness, partial results and resume validation
- [Terminal geometry](terminal-geometry.md), [app close guard](app-close-guard.md) and [Codex shared-server compatibility](codex-shared-server-compatibility.md)
- [Theming](theming.md) and [Fallow maintenance](fallow.md)
- [Workspace state invariants](../src/renderer/store/INVARIANTS.md)

## Smoke tests and evidence

- [SSH/VPS procedure](remote-vps-smoke-test.md) — guarded fixtures and remote checks
- [Checkout files](checkout-files-smoke-test.md), [dev servers](dev-services-smoke-test.md), [Markdown preview](markdown-preview-smoke-test.md) and [terminal image drops](terminal-image-drop-smoke-test.md)
- [Dated screenshots](screenshots/README.md) and [SSH preview capture evidence](evidence/issue-56/README.md) — historical assets, not current release acceptance
- `evidence/fallow-dead-code-baseline.json` and `evidence/fallow-production-dead-code-baseline.json` — active full/production identity-gate inputs; new findings and stale exemptions fail validation

## Deferred designs

- [Remote process persistence](design/remote-process-persistence.md) — proposed only, not a supported setting or reconnect feature

Completed issue reports, static health snapshots and old UI inventories are retained in
Git history and PRs, not mixed with current guides. Keep screenshots dated, distinguish
proposals from shipped behavior, and update release notes plus the relevant guide when
user-visible behavior changes.
