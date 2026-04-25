# Browser Tabs & History Plan

**Author:** Jay
**Date:** 2026-04-24
**Status:** Draft
**Version:** 2.0

---

## Purpose

Expand the browser panel with two capabilities:
1. **Tab support** — Each workspace's browser panel can hold multiple tabs, switched via a dropdown with tab count. Users can open new tabs via a "+" button in the dropdown.
2. **Global navigation history** — Persist a list of recently visited URLs globally (across workspaces). When typing in the URL bar, autocomplete suggestions appear from this history.

---

## Architecture Overview

### Current State (Before This Plan)

```
WorkspaceState {
  browserUrl: string              // workspace-level URL (single browser)
  browserPane: BrowserPaneState {  // pane metadata only
    id, locked, position
  }
}

BrowserPanel receives url as prop, manages local inputUrl state
Map<workspaceId, BrowserViewEntry> in main process
One WebContentsView per workspace
```

### Target State (After This Plan)

```
WorkspaceState {
  browserPane: BrowserPaneState {
    id, locked, position,
    tabs: BrowserTab[],           // NEW: array of tabs
    activeTabId: string | null     // NEW: which tab is active
  }
  // NOTE: browserUrl is removed - URL lives in BrowserTab.url
}

Map<workspaceId, Map<tabId, BrowserViewEntry>> in main process
Multiple WebContentsViews per workspace (one per tab)
Active tab's WebContentsView is visible; others are hidden
```

### Key Design Decisions

1. **Tab URL lives in `BrowserPaneState.tabs[]`, not workspace-level `browserUrl`**
   - Each `BrowserTab` has `url: string`
   - `BrowserPanel` reads from `activeTab.url` (via workspace store)
   - `browserUrl` field is removed from `WorkspaceState`

2. **One WebContentsView per tab, only active tab visible**
   - Main process maintains `Map<workspaceId, Map<tabId, BrowserViewEntry>>`
   - `BROWSER_SET_BOUNDS` only updates active tab's view bounds + visibility
   - Hidden tabs remain in memory (not destroyed)

3. **Global history (electron-store), not per-workspace**
   - Persisted at app level, survives workspace switches
   - Only http/https URLs stored (security)

4. **Preload bridge updated in parallel with main process**
   - New IPC channels must be added to: `ipcChannels.ts`, `browserIpc.ts`, `preload.ts`

---

## Scope

### In Scope

| Item | Priority | Notes |
|------|----------|-------|
| Browser tab data structure (per workspace) | P0 | `tabs[]` + `activeTabId` in `BrowserPaneState` |
| Tab UI: dropdown button showing count + "+" | P0 | In the browser toolbar |
| Switch tabs via dropdown | P0 | Click tab in dropdown |
| New tab (opens about:blank) | P0 | "+" button |
| Close tab (X button in dropdown) | P0 | Must not close last tab |
| URL autocomplete from history | P1 | Dropdown below input |
| History persistence (electron-store) | P1 | Survive app restart |
| History scoped to http/https only | P1 | Security: no file:// |

### Out of Scope

- Tab drag-to-reorder (deferred)
- Tab close behavior beyond "can't close last tab" (deferred)
- History max count configuration (deferred)
- Per-tab navigation history/back-forward (deferred — complex)
- Browser profile per tab (deferred)
- Tab close via middle-click on tab bar (deferred — no visible tab bar)

---

## What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| `BrowserPaneState` | `src/renderer/store/workspaceTypes.ts` | Partial — holds `id`, `position`, `locked` only |
| `BrowserPanel.tsx` | `src/renderer/components/BrowserPanel.tsx` | Exists — renders toolbar, url input, receives `url` prop |
| `browserIpc.ts` | `src/main/ipc/browserIpc.ts` | Exists — `BROWSER_NAVIGATE`, `BROWSER_SET_BOUNDS` etc. |
| `workspaceStore` | `src/renderer/store/workspaceStore.ts` | Partial — has `browserUrl` at workspace level |
| `workspaceStoreTypes` | `src/renderer/store/workspaceStoreTypes.ts` | Partial — browser state fields exist |
| `electron-store` | `npm install` | Present — used for settings/harness |
| IPC channels | `src/shared/ipcChannels.ts` | Exists — `BROWSER_*` channels defined |
| Preload bridge | `src/main/preload.ts` | Exists — `electronAPI.browserNavigate` etc. |

### Existing Patterns to Follow

```typescript
// Browser IPC handler pattern (browserIpc.ts)
ipcMain.handle(BROWSER_NAVIGATE, (_, workspaceId: string, url: string) => {
  // ... handler body
});
```

```typescript
// Preload API pattern (preload.ts)
browserNavigate: (workspaceId: string, url: string) =>
  ipcRenderer.invoke(BROWSER_NAVIGATE, workspaceId, url),
```

```typescript
// electron-store pattern (like settings)
const store = new Store({ name: 'browser-navigation-history' });
store.set('entries', []);
store.get('entries');
```

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| electron-store | Present | Used for settings/harness |
| IPC channels pattern | Present | Add new channels following existing pattern |
| Preload bridge pattern | Present | Add new APIs following existing pattern |

---

## Implementation Plan

### Phase Order

| Phase | Description | Depends On |
|-------|-------------|------------|
| Prereq | Types & Data Model — define `BrowserTab`, update `BrowserPaneState`, add IPC channels | — |
| 0 | Renderer: Tab State in Store — store actions, migrate `toggleBrowser` to create tabs | Prereq |
| 1 | Main Process: Multi-WebContentsView — manage multiple views per workspace | Prereq |
| 2 | UI: Tab Dropdown & BrowserPanel Refactor — dropdown UI, sync with active tab | Phase 0 |
| 3 | Global Navigation History: Storage & IPC — `browserHistory.ts`, history IPC | — |
| 4 | URL Autocomplete UI — autocomplete dropdown | Phase 3 |
| 5 | Integration & Validation — end-to-end test, `npm run validate` | Phase 2 + Phase 4 |

---

## Phase Details

### Phase Prereq — Types & Data Model + IPC Channel Constants

**Purpose:** Define the type structure for browser tabs, update `BrowserPaneState`, and add all new IPC channel constants.

**Scope:**
- [ ] Define `BrowserTab` interface:
  ```typescript
  export interface BrowserTab {
    id: string;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
  }
  ```
- [ ] Update `BrowserPaneState` to include:
  ```typescript
  export interface BrowserPaneState {
    id: string;
    position: PanePosition;
    locked: boolean;
    tabs: BrowserTab[];        // NEW
    activeTabId: string | null; // NEW
  }
  ```
  - **Invariant**: `tabs.length >= 1` (at least one tab always)
  - **Invariant**: `activeTabId !== null → tabs.some(t => t.id === activeTabId)`
- [ ] Add IPC channel constants to `src/shared/ipcChannels.ts`:
  - `BROWSER_CREATE_TAB` — create new tab in workspace
  - `BROWSER_CLOSE_TAB` — close tab in workspace
  - `BROWSER_SWITCH_TAB` — switch active tab
  - `BROWSER_GET_TABS` — get all tabs for workspace
  - `BROWSER_TAB_NAVIGATE` — navigate specific tab (different from current tab navigation)
  - `BROWSER_HISTORY_ADD` — add URL to history
  - `BROWSER_HISTORY_GET` — get history entries (with optional prefix filter)
  - `BROWSER_HISTORY_CLEAR` — clear all history
- [ ] Add event channel constant:
  - `BROWSER_TAB_URL_UPDATED` — main→renderer: tab navigated (contains tabId, url, title)
- [ ] Update `ALL_IPC_CHANNELS` array to include all new channels

**Out of Scope:**
- Store actions (Phase 0)
- Main process implementation (Phase 1)
- UI (Phase 2)

**Files to Modify:**
- `src/renderer/store/workspaceTypes.ts` — Add `BrowserTab` interface, update `BrowserPaneState`
- `src/shared/ipcChannels.ts` — Add new channel constants

**Context Files to Read:**
- `src/renderer/store/workspaceTypes.ts` — existing `BrowserPaneState` (line 24)
- `src/shared/ipcChannels.ts` — existing `BROWSER_*` constants pattern

---

### Phase 0 — Renderer: Tab State Management + Migration

**Purpose:** Add tab state to workspace store, implement tab operations, and migrate `toggleBrowser` to create initial tab.

**Scope:**
- [ ] Add store state shape:
  - `browserPane.tabs: BrowserTab[]`
  - `browserPane.activeTabId: string | null`
- [ ] Add store actions:
  - `addBrowserTab(workspaceId?)` — creates new tab with `about:blank`, sets as active
  - `removeBrowserTab(tabId, workspaceId?)` — removes tab, ensures >= 1 remain, switches active if needed
  - `setActiveBrowserTab(tabId, workspaceId?)` — sets active tab
  - `updateBrowserTab(tabId, partial: Partial<BrowserTab>, workspaceId?)` — updates tab fields (url, title, canGoBack, canGoForward)
- [ ] **Migrate `toggleBrowser`**: When first opening browser, create `BrowserPaneState` with:
  - `id`, `locked: false`, `position`
  - `tabs: [{ id: generateId('tab'), url: 'about:blank', title: 'New Tab', canGoBack: false, canGoForward: false }]`
  - `activeTabId: tabs[0].id`
- [ ] **Migrate existing workspaces** (on store load): If `browserPane` exists but `tabs` is undefined, initialize with single tab containing current `browserUrl`
- [ ] `updateWorkspaceBrowserUrl` (triggered by `BROWSER_URL_UPDATED` event) should update active tab's URL

**Out of Scope:**
- Main process WebContentsView management (Phase 1)
- UI dropdown (Phase 2)

**Files to Modify:**
- `src/renderer/store/workspaceStore.ts` — Add tab state and actions, migrate `toggleBrowser`
- `src/renderer/store/workspaceStoreTypes.ts` — Add action signatures
- `src/renderer/store/workspaceTypes.ts` — Already updated in Prereq

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/store/workspaceStore.ts` — `toggleBrowser` action (line 421), `setBrowserUrl` (line 519), `updateWorkspaceBrowserUrl` (line 526)
- `src/renderer/store/workspaceStoreTypes.ts` — existing action signatures

---

### Phase 1 — Main Process: Multi-WebContentsView Management

**Purpose:** Refactor `browserIpc.ts` to support multiple WebContentsViews per workspace (one per tab), switch between them, and wire up tab URL sync.

**Scope:**
- [ ] **Data structure**: Refactor from `Map<workspaceId, BrowserViewEntry>` to nested map:
  ```typescript
  // Old
  Map<workspaceId, BrowserViewEntry>
  // New
  Map<workspaceId, Map<tabId, BrowserViewEntry>>
  // where BrowserViewEntry = { view: WebContentsView, url: string }
  ```
- [ ] **Helper functions** (add to `browserIpc.ts` or export existing):
  - `ensureTabViewEntry(workspaceId, tabId, deps)` — gets or creates WebContentsView for tab
  - `switchToTab(workspaceId, tabId, deps)` — hides current tab's view, shows target tab's view
  - `destroyTabView(workspaceId, tabId, deps)` — closes WebContentsView for tab
  - `switchActiveTabOnClose(workspaceId, closedTabId, deps)` — when closing active tab, switch to adjacent tab (prefer next, then previous)
- [ ] **Update `BROWSER_SET_BOUNDS`**: Now operates on active tab's view only
  - Get active tabId from renderer state (passed in IPC payload or derived)
  - Only update and show the active tab's WebContentsView
- [ ] **Update `BROWSER_HIDE`**: Hide active tab's view (or all views if no active)
- [ ] **Add `BROWSER_CREATE_TAB` handler**:
  - Creates new `BrowserViewEntry` with fresh `WebContentsView` at `about:blank`
  - Returns `{ tabId, initialUrl: 'about:blank' }` to renderer
  - Renderer creates store tab, then calls `setActiveBrowserTab`
- [ ] **Add `BROWSER_CLOSE_TAB` handler**:
  - Destroys the WebContentsView for the tab
  - Renderer already called `removeBrowserTab` before this (or handles in store action)
  - If closing active tab, switch to adjacent tab
- [ ] **Add `BROWSER_SWITCH_TAB` handler**:
  - Calls `switchToTab(workspaceId, tabId, deps)`
  - Returns current tab URL so renderer can update URL bar
- [ ] **Add `BROWSER_GET_TABS` handler**:
  - Returns array of `{ tabId, url }` for workspace's tabs
  - Used for renderer state sync
- [ ] **Add `BROWSER_TAB_NAVIGATE` handler**:
  - Navigate a specific tab (tabId, url)
  - Used when switching to a tab that has a pending URL
- [ ] **Update `BROWSER_URL_UPDATED` event**:
  - Now includes `tabId` in payload: `{ workspaceId, tabId, url, title }`
  - Renderer uses `tabId` to find and update the correct tab in store
- [ ] **Add tab title sync**: On `did-navigate`, get `view.webContents.getTitle()` and include in `BROWSER_TAB_URL_UPDATED` event
- [ ] **Update `BROWSER_DISPOSE_WORKSPACE`**: Destroy all WebContentsViews for all tabs in workspace

**Out of Scope:**
- UI (Phase 2)

**Files to Modify:**
- `src/main/ipc/browserIpc.ts` — Refactor for multi-view, add tab handlers
- `src/main/preload.ts` — Add new API bindings

**New IPC Handlers:**
- `BROWSER_CREATE_TAB(workspaceId)` → `{ tabId: string, url: string }`
- `BROWSER_CLOSE_TAB(workspaceId, tabId)` → `boolean`
- `BROWSER_SWITCH_TAB(workspaceId, tabId)` → `{ url: string }`
- `BROWSER_GET_TABS(workspaceId)` → `Array<{ tabId: string, url: string }>`
- `BROWSER_TAB_NAVIGATE(workspaceId, tabId, url)` → `boolean`

**Context Files to Read:**
- `src/main/ipc/browserIpc.ts` — `ensureBrowserViewEntry`, `updateBrowserView`, `setActiveBrowserWorkspace`, `createBrowserViewForWorkspace`
- `src/main/main.ts` — `browserViews` map (line 78), `activeBrowserWorkspaceId` (line 79)

---

### Phase 2 — UI: Tab Dropdown & BrowserPanel Refactor

**Purpose:** Render the tab dropdown UI, wire up tab operations, and refactor `BrowserPanel` to read URL from active tab.

**Scope:**
- [ ] **BrowserPanel refactor**:
  - Remove `url` prop — URL now comes from active tab in store
  - Add `workspace` or `activeTab` from store
  - `inputUrl` state syncs from `activeTab.url` (on tab switch, on URL update event)
- [ ] **Tab count button in toolbar**:
  - Position: logical spot in toolbar (e.g., between stop/refresh and URL input)
  - Icon: simple number or tab-stack icon with count badge showing `tabs.length`
  - Click opens dropdown
- [ ] **Dropdown contents**:
  - List of tabs: show `tab.title` (truncated) or URL hostname
  - Active tab highlighted
  - Click to switch: call `setActiveBrowserTab(tabId)` → renderer calls `BROWSER_SWITCH_TAB` → update URL bar
  - Close (X) button per tab — only if `tabs.length > 1`
  - "+" button to open new tab
- [ ] **New tab flow**:
  1. User clicks "+"
  2. Renderer calls `addBrowserTab(workspaceId)` → creates tab in store
  3. Renderer calls `BROWSER_CREATE_TAB(workspaceId)` → main creates WebContentsView
  4. Renderer calls `setActiveBrowserTab(newTabId)`
  5. Renderer navigates to `about:blank` (or copies current URL — deferred)
- [ ] **Close tab flow**:
  1. User clicks X on tab in dropdown
  2. Renderer calls `removeBrowserTab(tabId)` → removes from store
  3. If was active: `setActiveBrowserTab(adjacentTabId)`
  4. Renderer calls `BROWSER_CLOSE_TAB(workspaceId, tabId)` → main destroys WebContentsView
- [ ] **URL input sync**:
  - On tab switch: update `inputUrl` to `activeTab.url`
  - On `BROWSER_TAB_URL_UPDATED`: update `inputUrl` for that tab
  - On navigate: update `activeTab.url` in store

**Out of Scope:**
- History autocomplete (Phase 4)
- Tab title fetch (basic — just show URL or placeholder)

**Files to Modify:**
- `src/renderer/components/BrowserPanel.tsx` — Refactor URL source, add tab dropdown
- `src/renderer/components/BrowserPanel.css` — Style the dropdown

**New Files:**
- None

**Context Files to Read:**
- `src/renderer/components/BrowserPanel.tsx` — existing toolbar layout, URL input handling
- `src/renderer/components/git/GitButton.tsx` — dropdown menu pattern

---

### Phase 3 — Global Navigation History: Storage & IPC

**Purpose:** Persist visited URLs globally using electron-store and expose via IPC.

**Scope:**
- [ ] **Create `src/main/browserHistory.ts`**:
  ```typescript
  import Store from 'electron-store';

  interface HistoryEntry {
    url: string;
    title?: string;
    lastVisited: number; // timestamp
  }

  interface BrowserHistoryStore {
    entries: HistoryEntry[];
  }

  const HISTORY_KEY = 'browserNavigationHistory';
  const MAX_ENTRIES = 100;

  export function addToHistory(url: string, title?: string): void {
    const store = new Store<BrowserHistoryStore>({ name: HISTORY_KEY });
    const entries = store.get('entries') ?? [];
    // Remove existing entry with same URL (update position)
    const filtered = entries.filter(e => e.url !== url);
    // Add to front
    filtered.unshift({ url, title, lastVisited: Date.now() });
    // Trim to max
    store.set('entries', filtered.slice(0, MAX_ENTRIES));
  }

  export function getHistory(prefix?: string): HistoryEntry[] {
    const store = new Store<BrowserHistoryStore>({ name: HISTORY_KEY });
    const entries = store.get('entries') ?? [];
    if (!prefix) return entries.slice(0, 8); // default limit 8
    const lower = prefix.toLowerCase();
    return entries.filter(e => e.url.toLowerCase().includes(lower)).slice(0, 8);
  }

  export function clearHistory(): void {
    const store = new Store<BrowserHistoryStore>({ name: HISTORY_KEY });
    store.set('entries', []);
  }
  ```
  - Only store http/https URLs (validate in `addToHistory`)
  - Max 100 entries, return up to 8 for autocomplete

- [ ] **Add IPC handlers in `browserIpc.ts`**:
  - `BROWSER_HISTORY_ADD(url, title?)` — call `addToHistory(url, title)`
  - `BROWSER_HISTORY_GET(prefix?)` — call `getHistory(prefix)`
  - `BROWSER_HISTORY_CLEAR()` — call `clearHistory()`

- [ ] **Wire up history on navigation**:
  - In `BROWSER_NAVIGATE` handler: after URL is validated and navigation starts, call `addToHistory(url)`
  - In `BROWSER_TAB_NAVIGATE` handler: same

**Out of Scope:**
- Autocomplete UI (Phase 4)

**Files to Modify:**
- `src/main/ipc/browserIpc.ts` — Add history IPC handlers

**New Files:**
- `src/main/browserHistory.ts` — History service

**Context Files to Read:**
- `src/main/credential/credentialService.ts` — electron-store usage pattern
- `src/main/ipc/browserIpc.ts` — `BROWSER_NAVIGATE` handler

---

### Phase 4 — URL Autocomplete UI

**Purpose:** Show autocomplete dropdown when typing in URL bar, powered by global history.

**Scope:**
- [ ] **In `BrowserPanel.tsx` URL input handling**:
  - Detect typing: on `onChange`, if `inputUrl.length >= 2`, query history
  - Debounce: 300ms before calling `BROWSER_HISTORY_GET`
  - Call `window.electronAPI.browserHistoryGet(inputUrl)`
- [ ] **Render autocomplete dropdown**:
  - Position below URL input
  - Show up to 8 entries: URL (primary) + title (secondary, if available)
  - Max height with scroll for overflow
- [ ] **Interaction**:
  - Click entry: navigate to that URL
  - Keyboard: Arrow keys to navigate list, Enter to select, Escape to close
  - Selection: navigate + add to history (history add is already in `BROWSER_NAVIGATE`)
- [ ] **Styling**: differentiate from regular dropdown, subtle appearance

**Out of Scope:**
- History persistence (Phase 3)

**Files to Modify:**
- `src/renderer/components/BrowserPanel.tsx` — Add autocomplete
- `src/renderer/components/BrowserPanel.css` — Style autocomplete dropdown

**Context Files to Read:**
- `src/renderer/components/BrowserPanel.tsx` — existing URL input and `handleNavigate`

---

### Phase 5 — Integration & Validation

**Purpose:** Ensure the feature works end-to-end and passes validation.

**Scope:**
- [ ] **Migration test**: Existing workspace (no tabs) opens browser → gets single tab
- [ ] **Tab operations**: Open tab → switch → close → verify state
- [ ] **URL sync**: Navigate → tab URL updates → URL bar updates → switch tab → URL bar shows correct URL
- [ ] **History**: Navigate to URL → type partial → autocomplete appears → select → navigate
- [ ] **Persistence**: Navigate → close app → reopen → type → history autocomplete works
- [ ] **Constraint**: Cannot close last tab (close button hidden when `tabs.length === 1`)
- [ ] **Run `npm run validate`** (lint, typecheck, build, test)
- [ ] **Add smoke tests** for new IPC handlers in `tests/main/`

**Out of Scope:**
- None (validation only)

**Files to Modify:**
- None

**New Files:**
- `tests/main/browserHistory.test.ts` — Test history service
- `tests/main/browserTabs.test.ts` — Test tab IPC handlers (if applicable)

---

## File Structure

Legend: `E` = exists, `M` = modify, `N` = new

```
src/
├── main/
│   ├── browserHistory.ts          N — global navigation history service
│   ├── preload.ts                 M — add new browser tab/history APIs
│   └── ipc/
│       └── browserIpc.ts         M — multi-view management, tab IPC, history IPC
├── renderer/
│   └── store/
│       ├── workspaceTypes.ts      M — BrowserTab interface, BrowserPaneState.tabs
│       └── workspaceStore.ts      M — tab actions, migrate toggleBrowser
│       └── workspaceStoreTypes.ts M — add tab action signatures
│   └── components/
│       └── BrowserPanel.tsx       M — tab dropdown, URL from activeTab, autocomplete
│       └── BrowserPanel.css       M — tab dropdown styles, autocomplete styles
└── shared/
    └── ipcChannels.ts            M — add BROWSER_CREATE_TAB, BROWSER_CLOSE_TAB, etc.
```

---

## New Dependencies

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| electron-store | 10.x | Browser history persistence | Already present |

---

## Testing Strategy

### Unit Tests
- [ ] `BrowserPaneState.tabs.length >= 1` invariant: cannot drop below 1 tab
- [ ] History add: ignores non-http/https URLs
- [ ] History get: returns entries matching prefix
- [ ] History get: returns empty for no matches

### Integration Tests
- [ ] Open tab → switch → close → verify store state
- [ ] Type URL → history add → refresh → autocomplete appears
- [ ] Migrate workspace without tabs → gets single tab

### Smoke Tests
- [ ] App launches with browser (creates 1 tab by default)
- [ ] `npm run validate` passes

---

## Rollout Plan

| Phase | Scope | Verification |
|-------|-------|--------------|
| Prereq | Type definitions + IPC constants | TypeScript compiles |
| 0 | Store tab actions + toggleBrowser migration | Store actions dispatch without error |
| 1 | Multi-WebContentsView | Can open/close/switch tabs in browser |
| 2 | Tab dropdown + BrowserPanel refactor | Count shows, dropdown opens, tabs switch |
| 3 | History service + IPC | History survives app restart |
| 4 | Autocomplete dropdown | Typing shows suggestions |
| 5 | Full integration | All flows work end-to-end |

---

## Success Story

> A user opens the app, creates a workspace, and clicks on the browser panel. The browser shows 1 tab labeled "New Tab" (default). The user navigates to `localhost:3000`, the URL bar shows the page and the tab title updates. The user clicks the tab count button (showing "1") and sees the dropdown with one entry. They click "+" to open a new blank tab. The count now shows "2". They navigate to `github.com` in the new tab. They switch back to the first tab — the URL bar shows `localhost:3000`. They close the second tab from the dropdown. The count goes back to "1". Later, in a different workspace, they type "local" in the URL bar and see `localhost:3000` autocomplete from history. They press Enter and navigate there.

---

## Related Documents

- `src/main/ipc/browserIpc.ts` — Main process browser management
- `src/renderer/components/BrowserPanel.tsx` — Browser UI
- `src/renderer/store/workspaceStore.ts` — State management
- `src/renderer/store/workspaceTypes.ts` — Type definitions
- `src/main/preload.ts` — Preload bridge
- `src/shared/ipcChannels.ts` — IPC channel constants

---

## Checklist

### Phase Prereq
- [ ] Define `BrowserTab` interface in `workspaceTypes.ts`
- [ ] Update `BrowserPaneState` to include `tabs` and `activeTabId`
- [ ] Add IPC channel constants to `ipcChannels.ts`
- [ ] Update `ALL_IPC_CHANNELS` array

### Phase 0
- [ ] Add tab state to workspace store
- [ ] Implement `addBrowserTab`, `removeBrowserTab`, `setActiveBrowserTab`, `updateBrowserTab`
- [ ] Migrate `toggleBrowser` to create initial tab
- [ ] Ensure invariant: at least 1 tab always exists

### Phase 1
- [ ] Refactor `browserIpc.ts` for multi-view (Map of Maps)
- [ ] Add tab IPC handlers: `BROWSER_CREATE_TAB`, `BROWSER_CLOSE_TAB`, `BROWSER_SWITCH_TAB`, `BROWSER_GET_TABS`, `BROWSER_TAB_NAVIGATE`
- [ ] Update `BROWSER_URL_UPDATED` to include `tabId`
- [ ] Update `BROWSER_DISPOSE_WORKSPACE` to destroy all tabs
- [ ] Add preload bindings for new APIs

### Phase 2
- [ ] Refactor `BrowserPanel` to read URL from `activeTab.url`
- [ ] Tab count button in toolbar
- [ ] Dropdown with tab list
- [ ] "+" to add new tab
- [ ] Close (X) per tab in dropdown (hidden when only 1 tab)

### Phase 3
- [ ] Create `browserHistory.ts` service
- [ ] Add history IPC handlers: `BROWSER_HISTORY_ADD`, `BROWSER_HISTORY_GET`, `BROWSER_HISTORY_CLEAR`
- [ ] Call `addToHistory` on `BROWSER_NAVIGATE` and `BROWSER_TAB_NAVIGATE`

### Phase 4
- [ ] Autocomplete dropdown below URL input
- [ ] Debounce 300ms
- [ ] Keyboard navigation
- [ ] Limit 8 entries

### Phase 5
- [ ] End-to-end test all flows
- [ ] `npm run validate` passes

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|---------|---------|
| 1.0 | 2026-04-24 | Jay | Initial draft |
| 2.0 | 2026-04-24 | Jay | Complete rewrite addressing gaps: URL flow architecture, toggleBrowser migration, preload bridge, IPC channels, main process data structure, BrowserPanel refactor, migration path, history add timing, tab close behavior, event channel spec |