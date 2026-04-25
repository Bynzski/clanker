# Browser Tabs & History Progress

Tracks which phases of the Browser Tabs & History plan have been completed.
Updated after each phase commit. Read by agent prompts to determine current state.

## Current Phase

**Phase Prereq** — Types & Data Model + IPC Channel Constants

## Phase Status

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| Prereq | Types & Data Model + IPC channels | 🔲 | — |
| 0 | Renderer: Tab State Management + Migration | 🔲 | — |
| 1 | Main Process: Multi-WebContentsView | 🔲 | — |
| 2 | UI: Tab Dropdown & BrowserPanel Refactor | 🔲 | — |
| 3 | Global Navigation History: Storage & IPC | 🔲 | — |
| 4 | URL Autocomplete UI | 🔲 | — |
| 5 | Integration & Validation | 🔲 | — |

## Status Legend

| Symbol | Meaning |
|--------|---------|
| 🔲 | Not started |
| 🔧 | In progress (agent working) |
| ✅ | Complete — committed and verified |
| ❌ | Blocked — see notes |

## Notes

- Plan document: `plans/browser-tabs-history/PLAN.md` (v2.0, Draft)
- All phases must pass `npm run validate` (lint, typecheck, build, test)
- Each phase gets one commit
- Read `plans/browser-tabs-history/PLAN.md` for detailed phase instructions

## Blocking Issues

- None currently

## Phase Details

### Phase Prereq

**Scope:** Define `BrowserTab` interface and update `BrowserPaneState` in `workspaceTypes.ts`. Add all new IPC channel constants to `ipcChannels.ts`. Update `ALL_IPC_CHANNELS` array.

**Key actions:**
- Define `BrowserTab { id, url, title, canGoBack, canGoForward }`
- Add `tabs: BrowserTab[]` and `activeTabId: string | null` to `BrowserPaneState`
- Add constants: `BROWSER_CREATE_TAB`, `BROWSER_CLOSE_TAB`, `BROWSER_SWITCH_TAB`, `BROWSER_GET_TABS`, `BROWSER_TAB_NAVIGATE`, `BROWSER_HISTORY_ADD`, `BROWSER_HISTORY_GET`, `BROWSER_HISTORY_CLEAR`, `BROWSER_TAB_URL_UPDATED`

### Phase 0

**Scope:** Add tab state to workspace store, implement `addBrowserTab`, `removeBrowserTab`, `setActiveBrowserTab`, `updateBrowserTab`. Migrate `toggleBrowser` to create initial tab with `about:blank`. Migrate existing workspaces (no tabs) on store load.

**Key migration:** `toggleBrowser` → creates `BrowserPaneState` with `tabs: [BrowserTab { id, url: 'about:blank', title: 'New Tab', canGoBack: false, canGoForward: false }]` and `activeTabId`.

### Phase 1

**Scope:** Refactor `browserIpc.ts` to use `Map<workspaceId, Map<tabId, BrowserViewEntry>>`. Add tab IPC handlers. Update `BROWSER_URL_UPDATED` to include `tabId`. Update preload bridge.

**Key changes:**
- `BROWSER_SET_BOUNDS` now operates on active tab only
- Add `switchToTab`, `destroyTabView`, `switchActiveTabOnClose` helpers
- Add `BROWSER_CREATE_TAB` → returns `{ tabId, url }`
- Add `BROWSER_CLOSE_TAB` → destroys view, switches active tab
- Add `BROWSER_SWITCH_TAB` → hides current, shows target, returns URL
- Add `BROWSER_GET_TABS`, `BROWSER_TAB_NAVIGATE`

### Phase 2

**Scope:** Refactor `BrowserPanel` to read URL from `activeTab.url` (not `url` prop). Add tab count button + dropdown.

**Key changes:**
- `BrowserPanel` no longer receives `url` prop — derives from `activeTab.url`
- Tab count button in toolbar (shows `tabs.length`)
- Dropdown: list of tabs, click to switch, X to close (hidden if 1 tab), + for new tab

### Phase 3

**Scope:** Create `browserHistory.ts` using electron-store. Add history IPC handlers. Call `addToHistory` on `BROWSER_NAVIGATE`.

**Key constraints:**
- Only http/https URLs stored
- Max 100 entries
- `getHistory` returns up to 8 entries

### Phase 4

**Scope:** Autocomplete dropdown below URL input.

**Key details:**
- Trigger: `inputUrl.length >= 2`
- Debounce: 300ms
- Max 8 entries
- Keyboard nav: arrows + Enter + Escape

### Phase 5

**Scope:** End-to-end verification.

**Key tests:**
- Migration: existing workspace without tabs
- Tab operations: open, switch, close
- URL sync across tab switches
- History autocomplete
- App restart: history persists

## Completed Phases

| Phase | Commit | Summary |
|-------|--------|---------|
| — | — | — |