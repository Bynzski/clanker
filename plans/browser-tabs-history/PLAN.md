# Browser Tabs & History Plan

**Author:** Jay
**Date:** 2026-04-25
**Status:** Approved
**Version:** 2.2

---

## Purpose

Expand the browser panel with two capabilities while preserving the current browser/layout reliability guarantees:

1. **Per-workspace browser tabs** — Each workspace browser pane can hold multiple tabs. Users switch tabs from a toolbar dropdown and create/close tabs from that dropdown.
2. **Global navigation history** — Recently visited HTTP(S) URLs are persisted globally and surfaced as autocomplete suggestions in the URL bar.

This is a risky feature because the browser panel is backed by native `WebContentsView` instances owned by the Electron main process. The implementation must preserve security, layout stability, workspace isolation, annotation behavior, and validation at every phase.

---

## Architecture Overview

### Current State

```ts
WorkspaceState {
  browserUrl: string;              // workspace-level URL
  browserPane: BrowserPaneState | null; // pane metadata only
}

BrowserPaneState {
  id: string;
  locked: boolean;
  position: PanePosition;
}

// main process
Map<workspaceId, BrowserViewEntry>
let activeBrowserWorkspaceId: string | null
```

The renderer owns workspace state and layout. The main process owns `WebContentsView` resources. `BrowserPanel` measures the browser content rectangle and sends bounds to main.

### Target State

```ts
WorkspaceState {
  browserUrl: string; // compatibility mirror of the active browser tab URL
  browserPane: BrowserPaneState | null;
}

BrowserPaneState {
  id: string;
  locked: boolean;
  position: PanePosition; // workspace browser surface bounds only
  tabs: BrowserTab[];
  activeTabId: string | null;
}

BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

// main process
Map<workspaceId, Map<tabId, BrowserViewEntry>>
Map<workspaceId, activeTabId>
Map<workspaceId, lastBrowserBounds>
let activeBrowserWorkspaceId: string | null
```

Only one tab view per workspace is visible at a time. Tab switching must never mutate pane layout or pane position.

---

## Non-Negotiable Invariants

### Security

- User/browser navigation remains restricted to `http:` and `https:` via `normalizeAppBrowserUrl`.
- `file:`, arbitrary `about:`, `javascript:`, `data:`, and other schemes must not be accepted from user input, history, or external links.
- New tabs open to the existing HTTP(S) default page, `https://github.com`. Do not introduce `about:blank` as part of this sprint.
- `about:blank` and other non-HTTP(S) schemes must never be stored in navigation history and must never be opened externally.
- History persists only normalized HTTP(S) URLs.

### Renderer Store

- If `browserPane !== null`, `browserPane.tabs.length >= 1`.
- If `browserPane.activeTabId !== null`, it references an existing tab in `browserPane.tabs`.
- Tab IDs are unique within a workspace.
- `browserPane.position` remains workspace browser-surface geometry; it is not moved into tab state.
- `browserUrl` mirrors the active tab URL only. Updating a non-active tab must not change `browserUrl`.
- Store operations that remove/switch tabs must be atomic and must return enough information for the UI/main IPC flow to stay aligned.

### Main Process

- Renderer generates tab IDs. Main process must not create independent IDs for renderer-visible tabs.
- A `WebContentsView` is created/ensured only with a renderer-provided tab ID.
- `BROWSER_HIDE(workspaceId)` hides all tab views for that workspace.
- `BROWSER_SET_BOUNDS(workspaceId, tabId, bounds)` records workspace-level bounds, hides sibling views, applies bounds to the active tab view, and shows exactly one view when visible.
- `BROWSER_SWITCH_TAB(workspaceId, tabId)` updates main's active tab map, hides sibling views, and applies the last known bounds to the target view if the workspace is active.
- Closing/disposal must close every `WebContentsView` for the affected tab/workspace and remove map entries.
- Annotation, app zoom, and lifecycle cleanup must target/iterate nested tab views correctly.

### Phase Validation

- Every implementation phase must be able to pass `npm run validate` independently.
- New IPC channels must be added to `ALL_IPC_CHANNELS` only in the same phase that registers their handlers/listeners.
- Preload APIs, `src/renderer/electron.d.ts`, test mocks, and IPC registration tests must be updated in the same phase as IPC surface changes.

---

## Scope

### In Scope

| Item | Priority | Notes |
|------|----------|-------|
| Browser tab model in workspace store | P0 | `BrowserTab[]` + `activeTabId` under `browserPane` |
| Store migration and sanitizer hardening | P0 | Handles old/malformed persisted browser pane states |
| Multi-`WebContentsView` main architecture | P0 | One view per workspace tab |
| Active tab tracking in main | P0 | Needed for compatibility APIs, annotation, and lifecycle |
| Tab dropdown UI | P0 | Count button, tab list, active indicator, +, close |
| Close tab behavior | P0 | Cannot close last tab; active close selects adjacent tab atomically |
| URL synchronization by tab ID | P0 | Main event payload includes `tabId` |
| Compatibility `browserUrl` mirror | P0 | Kept during migration |
| Global history storage | P1 | `electron-store`, max 100 entries |
| Autocomplete UI | P1 | Debounced URL suggestions with keyboard support |
| Tests across store/main/preload/UI | P0 | Coverage for non-happy paths |

### Out of Scope

- Drag-to-reorder tabs.
- Middle-click close.
- Per-tab persistent browser session/profile partition.
- Persisting full browser back/forward stacks.
- Configurable history max size.
- History deletion per entry.
- Full browser bookmarks.
- New visible tab strip outside the toolbar dropdown.

---

## Existing Code to Preserve and Extend

| Component | Location | Notes |
|-----------|----------|-------|
| Browser IPC | `src/main/ipc/browserIpc.ts` | Owns `WebContentsView` creation, navigation, bounds, security handlers |
| Main shared browser state | `src/main/main.ts` | Currently `Map<workspaceId, BrowserViewEntry>` and active workspace ID |
| Annotation IPC/controller | `src/main/annotation/annotationIpc.ts`, `src/main/annotation/annotationController.ts` | Currently looks up one browser view by workspace |
| Window zoom IPC | `src/main/ipc/windowIpc.ts` | Iterates browser views for zoom sync |
| Browser UI | `src/renderer/components/BrowserPanel.tsx` | Toolbar, URL input, bounds measurement, annotation controls |
| Browser panel consumer | `src/renderer/components/DynamicPaneLayout.tsx` | Passes browser props into `BrowserPanel` |
| URL update listener | `src/renderer/App.tsx` | Listens to `BROWSER_URL_UPDATED` and patches store |
| Workspace store | `src/renderer/store/workspaceStore.ts` | Owns tab actions and active workspace snapshot |
| Store helpers | `src/renderer/store/workspaceStoreHelpers.ts` | Sanitization, snapshot sync, consistency validation |
| Store types | `src/renderer/store/workspaceTypes.ts`, `src/renderer/store/workspaceStoreTypes.ts` | Browser pane and action signatures |
| Store invariants docs | `src/renderer/store/INVARIANTS.md` | Must document browser tab contracts |
| Preload bridge | `src/main/preload.ts` | Renderer API surface |
| Renderer API types | `src/renderer/electron.d.ts` | Must match preload |
| IPC channels | `src/shared/ipcChannels.ts` | Constants and `ALL_IPC_CHANNELS` |
| Test electron mock | `tests/setup/electron.ts` | Must include new preload methods |
| Fixtures | `tests/setup/fixtures.ts` | Must create valid browser tab state when browser pane exists |

---

## Implementation Plan

### Phase Order

| Phase | Description | Depends On | Validation Boundary |
|-------|-------------|------------|---------------------|
| 0 | Types, store migration, tab actions, invariants | — | Store and type tests pass; no new registered IPC channels |
| 1 | IPC surface compatibility bridge | Phase 0 | Preload/types/tests pass; handlers exist for channels added to `ALL_IPC_CHANNELS` |
| 2 | Main multi-view architecture | Phase 1 | Main IPC, annotation, zoom, lifecycle tests pass |
| 3 | Tab dropdown UI and BrowserPanel refactor | Phase 2 | Renderer UI tests pass |
| 4 | Global history service and IPC | Phase 2 | History handlers registered and tested |
| 5 | URL autocomplete UI | Phase 4 | Autocomplete renderer tests pass |
| 6 | Integration hardening, compatibility cleanup, and full validation | Phases 0-5 | unused compatibility helpers removed or documented; `npm run validate` passes |

---

## Phase 0 — Types, Store Migration, Tab Actions, Invariants

**Purpose:** Introduce browser tab state in the renderer store without changing the main IPC surface yet.

### Scope

- Add `BrowserTab` in `src/renderer/store/workspaceTypes.ts`:
  ```ts
  export interface BrowserTab {
    id: string;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
  }
  ```
- Extend `BrowserPaneState`:
  ```ts
  tabs: BrowserTab[];
  activeTabId: string | null;
  ```
- Add helper functions in `src/renderer/store/workspaceStoreHelpers.ts`:
  - `createDefaultBrowserTab(seedUrl?: string): BrowserTab`
  - `sanitizeBrowserPane(pane, browserUrl): BrowserPaneState | null`
  - `getActiveBrowserTab(browserPane): BrowserTab | null`
  - `syncBrowserUrlFromActiveTab(workspace): WorkspaceTab`
  - `ensureBrowserUrlForTab(url): string` or equivalent normalization for store defaults only
- Harden `sanitizeWorkspace` for:
  - missing `tabs`
  - empty `tabs`
  - missing/invalid `activeTabId`
  - duplicate tab IDs
  - missing tab URL/title/history flags
  - `browserPane.locked` missing
- Add workspace consistency warnings for:
  - `browserPane.tabs.length < 1`
  - duplicate tab IDs
  - invalid `activeTabId`
  - `browserUrl` not matching active tab URL
- Add store actions in `src/renderer/store/workspaceStoreTypes.ts` and `workspaceStore.ts`:
  ```ts
  addBrowserTab(workspaceId?: string): string | null;
  removeBrowserTab(tabId: string, workspaceId?: string): { removed: boolean; nextActiveTabId: string | null };
  setActiveBrowserTab(tabId: string, workspaceId?: string): boolean;
  updateBrowserTab(tabId: string, partial: Partial<BrowserTab>, workspaceId?: string): boolean;
  updateWorkspaceBrowserUrl(workspaceId: string, tabId: string | null, url: string, title?: string): void;
  ```
- `removeBrowserTab` must be atomic:
  - reject/no-op if it would remove the last tab
  - if removing active tab, select adjacent tab: prefer next, then previous
  - return selected `nextActiveTabId`
- `updateWorkspaceBrowserUrl` rules:
  - patch target workspace by `workspaceId`
  - if `tabId` is provided, update that tab only
  - if `tabId` is null, update active tab for compatibility
  - update `browserUrl` only if the updated tab is active
  - update top-level active workspace snapshot only when the target workspace is active
- `setBrowserUrl` remains a compatibility path and updates the active tab plus `browserUrl`.
- `toggleBrowser` creates a browser pane with one tab if no pane exists.
- Update `WorkspaceScope.tsx` fallback snapshots to include valid tab state.
- Update `tests/setup/fixtures.ts` so any fixture browser pane is valid.
- Update `src/renderer/store/INVARIANTS.md` with the tab and mirror contracts.

### New Tab Default URL Policy

New browser tabs must use the existing HTTP(S) default page, `https://github.com`. Do not add an `about:blank` internal sentinel in this sprint. This keeps tab creation aligned with the existing browser security policy and avoids scheme exceptions in navigation/history code.

### Out of Scope

- No new IPC channel constants in `ALL_IPC_CHANNELS`.
- No `WebContentsView` nested map refactor.
- No tab dropdown UI.
- No history service.

### Files to Modify

- `src/renderer/store/workspaceTypes.ts`
- `src/renderer/store/workspaceStoreTypes.ts`
- `src/renderer/store/workspaceStoreHelpers.ts`
- `src/renderer/store/workspaceStore.ts`
- `src/renderer/store/INVARIANTS.md`
- `src/renderer/components/WorkspaceScope.tsx`
- `tests/setup/fixtures.ts`
- Store/helper tests under `tests/renderer/`

### Required Tests

- Migrates old browser pane without `tabs` into one valid tab.
- Repairs empty `tabs`.
- Repairs invalid `activeTabId`.
- Deduplicates or replaces duplicate tab IDs.
- Cannot remove last tab.
- Removing active tab selects adjacent tab atomically.
- `browserUrl` mirrors only the active tab.
- Updating inactive workspace tab does not mutate active snapshot.
- Browser pane `position` is unchanged by all tab actions.

---

## Phase 1 — IPC Surface Compatibility Bridge

**Purpose:** Add tab-aware IPC contracts and renderer API types without yet requiring the full UI refactor. Every new channel added to `ALL_IPC_CHANNELS` in this phase must have a real handler/listener.

### Scope

- Add channel constants in `src/shared/ipcChannels.ts` for tab operations:
  - `BROWSER_CREATE_TAB`
  - `BROWSER_CLOSE_TAB`
  - `BROWSER_SWITCH_TAB`
  - `BROWSER_GET_TABS`
  - `BROWSER_TAB_NAVIGATE`
- Add these constants to `ALL_IPC_CHANNELS` in this phase because handlers are also added in this phase.
- Keep `BROWSER_URL_UPDATED` as the event channel. Do **not** add `BROWSER_TAB_URL_UPDATED`.
- Extend `BROWSER_URL_UPDATED` payload additively:
  ```ts
  {
    workspaceId: string;
    tabId?: string;
    url: string;
    title?: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
  }
  ```
- Add preload methods and renderer API types:
  ```ts
  browserCreateTab(workspaceId: string, tabId: string): Promise<{ url: string; title: string }>;
  browserCloseTab(workspaceId: string, tabId: string): Promise<boolean>;
  browserSwitchTab(workspaceId: string, tabId: string): Promise<{ url: string; title?: string } | null>;
  browserGetTabs(workspaceId: string): Promise<Array<{ tabId: string; url: string; title?: string }>>;
  browserTabNavigate(workspaceId: string, tabId: string, url: string): Promise<boolean>;
  ```
- Keep existing workspace-scoped APIs backward-compatible:
  - `browserSetBounds(workspaceId, bounds)` still exists.
  - `browserNavigate(workspaceId, url)` still exists.
  - `browserBack/Forward/Refresh/Stop`, `canGoBack/Forward` still exist.
- Add optional tab-aware overloads only if TypeScript/preload can support them cleanly:
  - `browserSetBounds(workspaceId, bounds, tabId?)`
  - `browserNavigate(workspaceId, url, tabId?)`
- Update `src/renderer/App.tsx` URL listener to accept `tabId` and call the Phase 0 store action correctly.
- Update `tests/setup/electron.ts`, preload tests, and IPC registration tests.

### Temporary Handler Behavior

Handlers may use the current single-view implementation internally, but they must be real and safe:

- `BROWSER_CREATE_TAB` records/ensures a tab entry with the renderer-provided ID.
- `BROWSER_SWITCH_TAB` updates active tab tracking, even before nested views are fully implemented.
- `BROWSER_CLOSE_TAB` rejects closing unknown/last tab if main can determine that state; otherwise safely returns `true` after removing tracked metadata.
- `BROWSER_TAB_NAVIGATE` validates URL using browser security rules and behaves like `BROWSER_NAVIGATE` for the target/active tab.

### Out of Scope

- Full nested `WebContentsView` map behavior.
- Tab dropdown UI.
- History IPC.

### Files to Modify

- `src/shared/ipcChannels.ts`
- `src/main/ipc/browserIpc.ts`
- `src/main/preload.ts`
- `src/renderer/electron.d.ts`
- `src/renderer/App.tsx`
- `tests/setup/electron.ts`
- `tests/main/unit/preload.test.ts`
- `tests/main/integration/ipcRegistration.test.ts`
- Relevant browser IPC tests

### Required Tests

- Every new tab IPC channel is registered.
- Preload exposes all new methods.
- `onBrowserUrlUpdated` accepts payloads with and without `tabId`.
- Existing workspace-scoped browser APIs still work.
- Invalid navigation URLs are rejected.

---

## Phase 2 — Main Multi-`WebContentsView` Architecture

**Purpose:** Replace one browser view per workspace with one browser view per workspace tab while preserving annotation, app zoom, and lifecycle behavior.

### Scope

- Update shared main browser types in `src/main/main.ts` and related IPC deps:
  ```ts
  Map<string, Map<string, BrowserViewEntry>>
  Map<string, string> activeBrowserTabIdsByWorkspace
  Map<string, Electron.Rectangle> lastBrowserBoundsByWorkspace
  ```
- Refactor `src/main/ipc/browserIpc.ts` helpers:
  - `getWorkspaceTabViews(workspaceId)`
  - `getActiveTabId(workspaceId)`
  - `setActiveTabId(workspaceId, tabId)`
  - `ensureTabViewEntry(workspaceId, tabId, deps)`
  - `hideWorkspaceTabViews(workspaceId, deps)`
  - `showTabView(workspaceId, tabId, deps)`
  - `destroyTabView(workspaceId, tabId, deps)`
  - `destroyWorkspaceBrowserViews(workspaceId, deps)`
- `ensureTabViewEntry` must create views only for renderer-provided tab IDs.
- View creation must attach existing handlers:
  - security handlers
  - shortcut handlers
  - context menu handlers
  - zoom sync
  - navigation URL reporting
- Navigation URL reporting must send `BROWSER_URL_UPDATED` with `workspaceId`, `tabId`, normalized URL, title, and navigation flags.
- `BROWSER_SET_BOUNDS` behavior:
  - supports legacy call without `tabId` by using main's active tab for the workspace
  - supports tab-aware call with `tabId`
  - stores latest bounds per workspace
  - hides all sibling views
  - applies bounds before showing target view
- `BROWSER_HIDE(workspaceId)` hides all tab views for that workspace.
- `BROWSER_SWITCH_TAB`:
  - validates tab exists or creates it only if invoked with renderer-provided tab ID
  - updates main active tab map
  - hides siblings
  - applies last known bounds if workspace is active
- `BROWSER_CLOSE_TAB`:
  - closes the tab view
  - removes tab map entry
  - if closing active tab, selects adjacent using main's known order when available; otherwise clears active and waits for renderer switch
  - never leaves a closed view visible
- `BROWSER_DISPOSE_WORKSPACE` closes all tab views for a workspace and clears active/bounds maps.
- Back/forward/refresh/stop/canGoBack/canGoForward target the active tab view.
- `BROWSER_GET_TABS` returns current main-known tab metadata.
- Update `src/main/annotation/annotationIpc.ts` and `annotationController.ts`:
  - annotation resolves active workspace + active tab view
  - switching/closing tabs while annotation is active must not leave injected runtime targeting a stale view
  - safest acceptable behavior: disable annotation on active tab switch/close and require user to re-enable
- Update `src/main/ipc/windowIpc.ts` so app zoom applies to every nested tab view.
- Update lifecycle cleanup and tests that assume a flat browser view map.

### Out of Scope

- Renderer tab dropdown UI.
- History persistence.
- Autocomplete.

### Files to Modify

- `src/main/main.ts`
- `src/main/ipc/browserIpc.ts`
- `src/main/ipc/windowIpc.ts`
- `src/main/annotation/annotationIpc.ts`
- `src/main/annotation/annotationController.ts`
- Main tests under `tests/main/unit/`

### Required Tests

- Creating two tabs creates two distinct views under one workspace.
- Bounds shows exactly one active tab and hides siblings.
- Switching tabs hides previous view and applies last bounds to target.
- Hiding workspace hides all its tab views.
- Closing active tab closes the view and does not leave stale active view visible.
- Disposing workspace closes all tab views.
- Back/forward/canGoBack/canGoForward target active tab.
- App zoom iterates all nested tab views.
- Annotation targets active tab or safely disables on tab switch/close.
- Invalid/non-HTTP(S) user navigation remains rejected.
- New tabs load `https://github.com`; `about:blank` is not introduced or special-cased in this sprint.

---

## Phase 3 — Tab Dropdown UI and BrowserPanel Refactor

**Purpose:** Expose tabs in the browser toolbar and wire UI actions to the tab-aware store and IPC APIs.

### Scope

- Refactor `BrowserPanel` to derive active tab state from scoped workspace/store instead of a `url` prop.
- Update `DynamicPaneLayout.tsx` to stop passing `url`/`onUrlChange` if no longer needed.
- Active tab URL drives:
  - URL input sync
  - open external
  - navigation target
  - displayed tab title/hostname fallback
- Bounds calls must pass the active tab ID when available:
  ```ts
  window.electronAPI.browserSetBounds(workspace.id, bounds, activeTab.id)
  ```
  while preserving compatibility with Phase 1 signatures.
- Navigation flow:
  1. normalize user input in renderer as today by adding `https://` when missing
  2. call `browserTabNavigate(workspace.id, activeTab.id, navigateUrl)`
  3. optimistically update active tab URL only if IPC returns true, or rely on `BROWSER_URL_UPDATED` for committed update
- New tab flow:
  1. `const tabId = addBrowserTab(workspaceId)`
  2. `browserCreateTab(workspaceId, tabId)`
  3. `setActiveBrowserTab(tabId, workspaceId)`
  4. `browserSwitchTab(workspaceId, tabId)`
  5. schedule/force bounds update for the new active tab
- Close tab flow:
  1. prevent row-click propagation from the X button
  2. call `removeBrowserTab(tabId, workspaceId)` and capture `nextActiveTabId`
  3. call `browserCloseTab(workspaceId, tabId)`
  4. if active changed, call `browserSwitchTab(workspaceId, nextActiveTabId)`
  5. schedule/force bounds update
- Switch tab flow:
  1. `setActiveBrowserTab(tabId, workspaceId)`
  2. `browserSwitchTab(workspaceId, tabId)`
  3. input URL updates from active tab state
  4. schedule/force bounds update
- Add toolbar dropdown:
  - button shows tab count
  - active tab highlighted
  - title fallback order: `tab.title`, hostname, URL, `New Tab`
  - close button hidden/disabled when only one tab
  - plus button creates tab
- Back/forward button enabled state should use active tab state when available. Existing polling may remain as a safety net, but must update active tab fields.

### Out of Scope

- Autocomplete/history UI.
- Drag/reorder tabs.
- Middle-click close.

### Files to Modify

- `src/renderer/components/BrowserPanel.tsx`
- `src/renderer/components/BrowserPanel.css`
- `src/renderer/components/DynamicPaneLayout.tsx`
- `src/renderer/store/workspaceStore.ts` if UI exposes action edge cases
- Renderer tests for `BrowserPanel`, `DynamicPaneLayout`, and `App`

### Required Tests

- Tab count renders correctly.
- Dropdown opens/closes.
- Plus creates store tab and calls IPC with the same tab ID.
- Switching tabs calls store + IPC and updates URL input.
- Close button does not propagate to row switch.
- Last tab cannot be closed.
- Closing active tab selects adjacent tab.
- Browser bounds are resent on tab switch/new tab.
- Open external uses active tab URL.
- Back/forward state follows active tab.

---

## Phase 4 — Global Navigation History Service and IPC

**Purpose:** Persist committed HTTP(S) navigations globally and expose history queries through IPC.

### Scope

- Create `src/main/browserHistory.ts`.
- Define:
  ```ts
  export interface BrowserHistoryEntry {
    url: string;
    title?: string;
    lastVisited: number;
  }
  ```
- Use `electron-store` with a stable store name, e.g. `browser-navigation-history`.
- Enforce:
  - only normalized HTTP(S) URLs are stored
  - `about:blank` and all other non-HTTP(S) URLs are ignored
  - duplicates are moved to the front with updated `lastVisited`/title
  - max 100 entries
  - queries return max 8 entries
- Prefix/search behavior should match user expectations:
  - normalized full URL lowercased
  - hostname lowercased
  - hostname + pathname lowercased
  - optional stripped `www.` variant
- Add IPC constants and handlers in the same phase:
  - `BROWSER_HISTORY_ADD`
  - `BROWSER_HISTORY_GET`
  - `BROWSER_HISTORY_CLEAR`
- Add constants to `ALL_IPC_CHANNELS` only after handlers are registered.
- Add preload methods and renderer API types:
  ```ts
  browserHistoryGet(prefix?: string): Promise<BrowserHistoryEntry[]>;
  browserHistoryAdd(url: string, title?: string): Promise<boolean>;
  browserHistoryClear(): Promise<boolean>;
  ```
- Wire history writes from successful `did-navigate` / `did-navigate-in-page` browser events after URL/title normalization.
- Keep explicit `browserHistoryAdd` IPC for future use/tests, but normal app history should be committed from successful navigation events.

### Out of Scope

- Autocomplete UI.
- Per-entry delete.
- Configurable max history count.

### Files to Modify

- `src/main/browserHistory.ts` new
- `src/main/ipc/browserIpc.ts`
- `src/shared/ipcChannels.ts`
- `src/main/preload.ts`
- `src/renderer/electron.d.ts`
- `tests/setup/electron.ts`
- `tests/main/unit/preload.test.ts`
- `tests/main/integration/ipcRegistration.test.ts`
- `tests/main/browserHistory.test.ts` new

### Required Tests

- Rejects `file:`, `data:`, `javascript:`, arbitrary `about:`, and empty URLs.
- Does not store `about:blank` or any other non-HTTP(S) URL.
- Dedupes and updates `lastVisited`.
- Caps stored entries at 100.
- Query caps results at 8.
- Prefix matching works for `git`, `github.com`, `https://github`, `localhost`, and hostname/path forms.
- History IPC channels are registered and preload exposes methods.

---

## Phase 5 — URL Autocomplete UI

**Purpose:** Show history suggestions below the URL input while typing.

### Scope

- In `BrowserPanel.tsx`, query history when:
  - URL input is focused
  - user input length is at least 2 after trimming
  - input is user-edited, not merely synced from active tab switch
- Debounce history queries by 300ms.
- Render up to 8 suggestions below the URL input.
- Suggestion display:
  - URL primary
  - title secondary if present
- Interactions:
  - click suggestion navigates active tab to that URL
  - ArrowDown/ArrowUp move highlighted suggestion
  - Enter selects highlighted suggestion if dropdown open; otherwise normal navigate
  - Escape closes suggestions
  - blur closes suggestions after allowing click selection
- Selecting a suggestion should navigate through the same `browserTabNavigate` path as manual entry. History is updated by successful navigation events, not by selection.
- Styling must not conflict with tab dropdown styling.

### Out of Scope

- History management screen.
- Per-entry deletion.
- Fuzzy matching beyond the Phase 4 prefix/search behavior.

### Files to Modify

- `src/renderer/components/BrowserPanel.tsx`
- `src/renderer/components/BrowserPanel.css`
- `tests/renderer/unit/BrowserPanel.test.tsx`

### Required Tests

- Debounces calls by 300ms.
- Does not query for fewer than 2 characters.
- Renders suggestions returned by IPC.
- Click suggestion navigates active tab.
- Keyboard selection works.
- Escape closes suggestions.
- Switching tabs clears stale suggestions and syncs input to active tab URL.

---

## Phase 6 — Integration Hardening, Compatibility Cleanup, and Full Validation

**Purpose:** Exercise the complete feature across renderer store, main browser resources, UI, history, and workspace switching, then clean up any sprint-only compatibility bridge code that is no longer needed.

### Scope

- Add or update integration coverage for:
  - old persisted workspace migration
  - malformed browser tab migration
  - open tab → navigate → open second tab → switch → close active/inactive tab
  - workspace switch with multiple tabs in both workspaces
  - browser pane bounds stable across tab operations
  - annotation behavior with tab switch/close
  - app zoom with multiple hidden tab views
  - history persists across app restart/store re-instantiation
  - autocomplete selects and navigates
- Verify no stale views remain visible after:
  - tab switch
  - browser hide
  - workspace switch
  - workspace dispose
  - close active tab
- Run:
  ```bash
  npm run validate
  ```
- Fix only regressions related to this plan.
- Cleanup sprint-only bridge code:
  - remove unused compatibility helpers/wrappers after renderer callers are migrated, or
  - document retained wrappers as supported backwards-compatible API in code comments/tests
  - remove temporary test-only scaffolding that is no longer needed
  - ensure no duplicate tab/navigation paths remain where one canonical path should be used

### Out of Scope

- New features beyond the planned browser tabs/history behavior.

### Files Likely to Modify

- `tests/main/unit/browserIpc.test.ts`
- `tests/main/unit/windowIpc.test.ts`
- `tests/main/unit/annotation/annotationIpc.test.ts`
- `tests/renderer/integration/workspaceStore.test.ts`
- `tests/renderer/unit/BrowserPanel.test.tsx`
- `tests/renderer/unit/App.test.tsx`
- `tests/renderer/unit/DynamicPaneLayout.test.tsx`
- `tests/setup/fixtures.ts`

---

## File Structure

Legend: `M` = modify, `N` = new

```text
src/
├── main/
│   ├── main.ts                         M — nested browser maps and active tab/bounds state
│   ├── browserHistory.ts               N — global navigation history service
│   ├── preload.ts                      M — tab/history preload APIs
│   ├── ipc/
│   │   ├── browserIpc.ts               M — tabbed WebContentsView management and history IPC
│   │   └── windowIpc.ts                M — zoom iteration over nested browser views
│   └── annotation/
│       ├── annotationIpc.ts            M — active tab view lookup / safe disable behavior
│       └── annotationController.ts     M — nested browser view lookup support
├── renderer/
│   ├── App.tsx                         M — URL update event payload with tabId
│   ├── electron.d.ts                   M — tab/history API types
│   ├── store/
│   │   ├── workspaceTypes.ts           M — BrowserTab, BrowserPaneState tabs
│   │   ├── workspaceStoreTypes.ts      M — tab action signatures
│   │   ├── workspaceStoreHelpers.ts    M — migration/sanitization/invariant helpers
│   │   ├── workspaceStore.ts           M — tab actions and browserUrl mirror
│   │   ├── workspaceLayout.ts          M — only if type or invariant adjustments require it
│   │   └── INVARIANTS.md               M — browser tab contracts
│   └── components/
│       ├── WorkspaceScope.tsx          M — fallback snapshot tab compatibility
│       ├── DynamicPaneLayout.tsx       M — BrowserPanel props
│       ├── BrowserPanel.tsx            M — tab dropdown and autocomplete
│       └── BrowserPanel.css            M — dropdown/autocomplete styling
└── shared/
    └── ipcChannels.ts                  M — add channels only with handlers

tests/
├── setup/
│   ├── electron.ts                     M — preload mock methods
│   └── fixtures.ts                     M — valid browser tab fixtures
├── main/
│   ├── browserHistory.test.ts          N — history service tests
│   ├── unit/browserIpc.test.ts         M — tabbed browser IPC tests
│   ├── unit/windowIpc.test.ts          M — nested zoom tests
│   ├── unit/preload.test.ts            M — preload API tests
│   └── integration/ipcRegistration.test.ts M — channel registration
└── renderer/
    ├── integration/workspaceStore.test.ts M — store tab/migration tests
    └── unit/BrowserPanel.test.tsx      M — tab/autocomplete UI tests
```

---

## Testing Strategy Summary

### Store Tests

- Migration from old browser pane.
- Malformed tab state repair.
- Active tab and `browserUrl` mirror invariants.
- Last-tab close rejection.
- Active close adjacent selection.
- Bounds/position stability.

### Main Tests

- Renderer-provided tab IDs are preserved.
- One visible view per workspace.
- Hide/dispose close all relevant views.
- Navigation security remains enforced.
- Annotation and zoom work with nested maps.
- History records only committed HTTP(S) navigations.

### Renderer UI Tests

- Dropdown behavior.
- New/switch/close tab flows.
- URL input sync across tab switches.
- Active tab navigation.
- Autocomplete debounce and keyboard/mouse selection.

### Validation

Every phase must run at least targeted tests for touched areas. Final phase must run:

```bash
npm run validate
```

---

## Rollout / Execution Rules

- New tabs open to `https://github.com`; do not add an internal `about:blank` exception in this sprint.
- Do not add channels to `ALL_IPC_CHANNELS` before handlers/listeners exist.
- Do not break existing workspace-scoped browser APIs until all renderer callers are migrated; bounded compatibility wrappers are allowed as phase bridges.
- Do not bypass `normalizeAppBrowserUrl` for user navigation.
- Do not import main modules from renderer.
- Do not create a browser view in main without a renderer-provided tab ID after Phase 2.
- Do not leave hidden/stale `WebContentsView` instances visible across tab/workspace switches.
- If a phase cannot pass validation independently, stop and adjust the plan rather than pushing broken intermediate state.

---

## Success Story

A user opens a workspace and enables the browser. The browser pane has one tab loaded to `https://github.com`. They navigate to `localhost:3000`; the active tab URL and workspace `browserUrl` mirror update after committed navigation. They open a second tab from the dropdown, which also starts at `https://github.com`, navigate it elsewhere, switch back to the first tab, and the URL input returns to `localhost:3000`. Closing the second tab destroys its native view and leaves the first tab visible at the same pane bounds. In another workspace, typing `local` in the URL bar shows `localhost:3000` from global history. Selecting it navigates the active tab. Throughout this flow, only HTTP(S) user URLs are accepted, annotation never targets a stale view, workspace switching never leaves a stale browser view visible, and temporary compatibility bridge code has been removed or documented by the end of the sprint.

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-24 | Jay | Initial draft |
| 2.0 | 2026-04-24 | Jay | Rewrite covering tab model, IPC, migration, history, and UI |
| 2.1 | 2026-04-25 | Jay + review | Hardened phase boundaries, validation rules, security policy, nested main-process impacts, annotation/zoom/lifecycle coverage, store invariants, and non-happy-path tests |
| 2.2 | 2026-04-25 | Jay + review | Approved default new-tab URL as `https://github.com`, accepted bounded compatibility wrappers for sprint execution, and added Phase 6 cleanup requirements |
