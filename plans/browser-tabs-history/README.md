# Browser Tabs & History

Expanding the browser panel with:
1. **Tabs** — Per-workspace browser tabs with a dropdown showing count + "+" to open new tabs
2. **Global navigation history** — Persist recently visited URLs globally; autocomplete when typing in URL bar

## Plan Documents

- [PLAN.md](PLAN.md) — Full implementation plan with phases, scope, and file structure
- [PROGRESS.md](PROGRESS.md) — Phase tracking (status, commits, blocking issues)

## Quick Start

Execute phase 0:
```
Execute Phase Prereq of browser-tabs-history plan.
PLAN_PATH: plans/browser-tabs-history/
```

## Phase Overview

| Phase | Description |
|-------|-------------|
| Prereq | Types & Data Model — `BrowserTab` interface, `BrowserPaneState` update |
| 0 | Renderer: Tab State Management — store actions for tabs |
| 1 | Main Process: Multi-WebContentsView — multiple views per workspace |
| 2 | UI: Tab Dropdown — count button + dropdown with tab list |
| 3 | Global Navigation History — electron-store backed history service |
| 4 | URL Autocomplete UI — autocomplete dropdown below URL input |
| 5 | Integration & Validation — end-to-end test, `npm run validate` |

## Success Criteria

> A user opens the app and the browser shows 1 tab. They click the tab count button showing "1", see a dropdown, click "+" to open a new tab (count becomes 2). They navigate between tabs. In a different workspace, typing in the URL bar shows autocomplete suggestions from history. History persists across app restarts.

## Files Involved

| File | Change |
|------|--------|
| `src/shared/types/workspaceTypes.ts` | Add `BrowserTab`, update `BrowserPaneState` |
| `src/renderer/store/workspaceStore.ts` | Tab state and actions |
| `src/renderer/store/workspaceStoreTypes.ts` | Tab action signatures |
| `src/main/ipc/browserIpc.ts` | Multi-view management, tab IPC |
| `src/main/browserHistory.ts` | 🆕 History service |
| `src/renderer/components/BrowserPanel.tsx` | Tab dropdown + autocomplete UI |
| `src/renderer/components/BrowserPanel.css` | Dropdown styles |

## Validation

All phases must pass:
```bash
npm run validate
```
(lint → typecheck → build → test)