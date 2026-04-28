# Windows Build Plan — Index

Implements `plans/windows-build-gap-analysis.md`. Tracks progress in `PROGRESS.md`.

## Documents

| File | Purpose |
|------|---------|
| [PLAN.md](./PLAN.md) | Full plan: scope, phases, file lists, testing strategy. |
| [PROGRESS.md](./PROGRESS.md) | Phase tracker. Updated after each phase commit. |
| [AGENT-PROMPT.md](./AGENT-PROMPT.md) | Self-contained directive for an agent executing a phase. |
| [QUICKSTART.md](./QUICKSTART.md) | Skill template (kept for reference). |
| [CHECKLIST.md](./CHECKLIST.md) | Quality review checklist (kept for reference). |

## Plan Snapshot

**Status:** Approved · **Version:** 1.2 · **Author:** Jay · **Date:** 2026-04-28

**Purpose:** Close the Windows-build gaps so Clanker Grid produces a working unsigned NSIS + portable build on `windows-latest` CI, while preserving the existing Linux AppImage release path. Final release smoke verifies Linux AppImage + Windows NSIS + Windows portable artifacts.

**Locked-in defaults:** Unsigned for v0.1 · Win10 1809+ minimum · PowerShell default shell · No WSL target.

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Prereq | `windows-latest` CI matrix entry (continue-on-error) | 🔲 |
| 0 | Tests platform-neutral | 🔲 |
| 1 | Cross-platform harness wrapper + shell/PATH defaults | 🔲 |
| 2 | node-pty / ConPTY validation on real Windows | 🔲 |
| 3 | Canonical path normalization at IPC boundary | 🔲 |
| 4 | Cross-drive rename + open-file mutation | 🔲 |
| 5 | Reserved names + atomic-save watcher tuning | 🔲 |
| 6 | Credential / SSH permission policy on Windows | 🔲 |
| 7 | Husky on Windows | 🔲 |
| 8a | Delete safety + CRLF preservation | 🔲 |
| 8b | UNC / drive-letter / polling / long-path handling | 🔲 |
| 8c | Case-insensitive path keying + case-only rename | 🔲 |
| 8d | Verify-only Windows polish sweep | 🔲 |
| 9 | Linux AppImage + unsigned NSIS/portable release smoke and v0.1 prep | 🔲 |

CI gate flips from `continue-on-error: true` to required at the end of Phase 5.

## Executing a Phase

```
Execute the next phase of the windows-build plan.
PLAN_PATH: plans/windows-build/
```

The agent will:
1. Read `PROGRESS.md` to find the next 🔲 phase.
2. Read the matching section of `PLAN.md`.
3. Read `AGENTS.md` for architecture rules.
4. Execute the phase per scope.
5. Run `npm run validate`.
6. Commit and update `PROGRESS.md` (🔲 → ✅).

## Related

- `plans/windows-build-gap-analysis.md` — source-of-truth gap analysis.
- `AGENTS.md` — architecture principles.
- `~/.pi/agent/skills/planning/SKILL.md` — planning skill that authored this plan.
