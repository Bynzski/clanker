# Browser Tabs & History Progress

Tracks which phases of the Browser Tabs & History plan have been completed.
Updated after each phase commit. Read by agent prompts to determine current state.

## Current Phase

**Phase 5** — URL Autocomplete UI

## Phase Status

| Phase | Description | Status | Commit |
|-------|-------------|--------|--------|
| 0 | Types, Store Migration, Tab Actions, Invariants | ✅ | e98e120 |
| 1 | IPC Surface Compatibility Bridge | ✅ | 4fd0d10 |
| 2 | Main Process: Multi-WebContentsView Architecture | ✅ | 7510427 |
| 3 | UI: Tab Dropdown & BrowserPanel Refactor | ✅ | 2ff6070 |
| 4 | Global Navigation History: Storage & IPC | ✅ | 33c679b |
| 5 | URL Autocomplete UI | 🔲 | — |
| 6 | Integration Hardening, Compatibility Cleanup & Full Validation | 🔲 | — |

## Status Legend

| Symbol | Meaning |
|--------|---------|
| 🔲 | Not started |
| 🔧 | In progress (agent working) |
| ✅ | Complete — committed and verified |
| ❌ | Blocked — see notes |

## Notes

- Plan document: `plans/browser-tabs-history/PLAN.md` (v2.2, Approved)
- Every phase must be independently validateable.
- New IPC channels must be added to `ALL_IPC_CHANNELS` only in the same phase that registers handlers/listeners.
- All phases must preserve browser security constraints: user navigation is HTTP(S)-only; new tabs open to `https://github.com`; `about:blank` is not introduced or special-cased in this sprint.
- Bounded compatibility wrappers are allowed as phase bridges, but Phase 6 must remove unused wrappers or document retained wrappers as supported API.
- Final phase must run `npm run validate` (lint, typecheck, build, test).
- Each phase gets one commit.

## Blocking Issues / Decisions Before Approval

- None. Default new-tab URL is `https://github.com`.
- Compatibility wrappers are approved for sprint execution and must be cleaned up or documented in Phase 6.

## Phase Details

### Phase 0 — Types, Store Migration, Tab Actions, Invariants

**Scope:** Add `BrowserTab`, extend `BrowserPaneState`, implement store tab actions, harden workspace sanitization/migration, document invariants, and update fixtures/tests. No new IPC channels are added to `ALL_IPC_CHANNELS` in this phase.

**Key checks:** old/malformed browser panes migrate to valid tabs; cannot close last tab; active tab URL mirrors `browserUrl`; inactive tab updates do not mutate `browserUrl`; pane position remains stable.

### Phase 1 — IPC Surface Compatibility Bridge

**Scope:** Add tab IPC constants, handlers, preload APIs, `electron.d.ts` types, mocks, and registration/preload tests. Keep existing workspace-scoped browser APIs compatible while adding tab-aware APIs. Reuse `BROWSER_URL_UPDATED` with additive `tabId` payload.

**Key checks:** every channel in `ALL_IPC_CHANNELS` is registered; preload exposes new methods; existing browser calls still work.

### Phase 2 — Main Process: Multi-WebContentsView Architecture

**Scope:** Refactor main browser state to nested workspace/tab maps, add active-tab and last-bounds maps, update browser IPC helpers, hide/dispose all tab views correctly, and update annotation/window zoom/lifecycle behavior for nested views.

**Key checks:** exactly one tab view visible per workspace; switching applies last bounds; hide hides all tab views; dispose closes all tab views; annotation and zoom target nested views correctly.

### Phase 3 — UI: Tab Dropdown & BrowserPanel Refactor

**Scope:** Refactor `BrowserPanel` to use active tab state, add tab dropdown UI, wire new/switch/close flows through store + IPC, pass active tab ID with bounds/navigation, and keep URL input synced.

**Key checks:** new tab uses same renderer-generated ID in store and IPC; close does not propagate to row switch; last tab cannot close; bounds are resent on tab switch.

### Phase 4 — Global Navigation History: Storage & IPC

**Scope:** Create `browserHistory.ts`, add history IPC channels/handlers/preload/types/mocks, record committed HTTP(S) navigations from browser events, and test normalization/dedupe/caps.

**Key checks:** non-HTTP(S), including `about:blank`, is rejected from history; max 100 stored; max 8 returned; prefix matching works for URL and hostname inputs.

### Phase 5 — URL Autocomplete UI

**Scope:** Add debounced history suggestions below the URL input, keyboard/mouse interactions, and tests. Suggestions navigate through the active tab navigation path.

**Key checks:** debounce works; no query below 2 chars; Enter/Arrow/Escape behavior works; switching tabs clears stale suggestions.

### Phase 6 — Integration Hardening, Compatibility Cleanup & Full Validation

**Scope:** End-to-end hardening across store/main/UI/history/workspace switching, clean up or document sprint compatibility wrappers, then run `npm run validate`.

**Key checks:** workspace switches with multiple tabs do not leak visible views; history persists; annotation/zoom remain safe; all validation passes.

## Completed Phases

| Phase | Commit | Summary |
|-------|--------|---------|
| 0 | e98e120 | BrowserTab type + tabs/activeTabId on BrowserPaneState; tab actions (add/remove/setActive/update) with atomic last-tab guard; sanitizer migrates legacy/malformed panes; B1..B4 invariants; updateWorkspaceBrowserUrl tab-aware signature; INVARIANTS.md updated. |
| 1 | 4fd0d10 | Tab IPC channels + handlers (create/close/switch/get/tab-navigate) registered with ALL_IPC_CHANNELS; per-workspace tab record/order/active maps; BROWSER_URL_UPDATED payload extended with optional tabId/title/canGoBack/canGoForward; browserSetBounds/browserNavigate gain optional tabId; preload + electron.d.ts + mocks updated; App.tsx URL listener forwards tabId/title. |
| 2 | 7510427 | Nested main-process browser view maps with per-tab `WebContentsView` creation; active tab and bounds tracking; tab-aware navigation/bounds/hide/close/dispose; nested zoom iteration; active-tab annotation resolution and disable-on-switch behavior; main tests for multi-tab visibility/disposal and zoom. |
| 3 | 2ff6070 | BrowserPanel now derives URL/navigation state from the active browser tab; tab dropdown supports count, create, switch, close, and last-tab guard flows; bounds/navigation IPC includes active tab ID; DynamicPaneLayout uses tab-aware BrowserPanel; renderer tests cover dropdown, same-ID create IPC, switch, close propagation, bounds resend, external URL, and active-tab navigation. |
| 4 | 33c679b | Added persistent browser history service backed by `browser-navigation-history`; HTTP(S)-only normalization, dedupe, max-100 storage, max-8 queries, hostname/path prefix matching; history IPC/preload/types/mocks; committed navigation event recording; service, IPC, channel, registration, and preload tests. |
