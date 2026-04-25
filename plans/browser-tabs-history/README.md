# Browser Tabs & History

Plan for adding robust per-workspace browser tabs and global navigation history to the Electron browser panel.

## Status

- **Version:** 2.2
- **Status:** Approved
- **Current phase:** Phase 0 — Types, Store Migration, Tab Actions, Invariants
- **Approval blockers:** none. New tabs open to `https://github.com`; bounded compatibility wrappers are approved for sprint execution and cleaned up or documented in Phase 6.

## Plan Documents

- [PLAN.md](PLAN.md) — Full implementation plan with phases, invariants, file structure, and tests
- [PROGRESS.md](PROGRESS.md) — Phase tracking, current phase, blocking decisions
- [AGENT-PROMPT.md](AGENT-PROMPT.md) — Generic execution directive for phase agents
- [CHECKLIST.md](CHECKLIST.md) — Plan quality checklist
- [QUICKSTART.md](QUICKSTART.md) — Planning quick reference

## Scope Summary

1. **Tabs** — Browser tabs live under each workspace's `browserPane`; one native `WebContentsView` per tab.
2. **Store compatibility** — `browserUrl` remains as a compatibility mirror of the active tab URL.
3. **Main-process safety** — Main tracks nested browser views, active tab per workspace, and last browser bounds per workspace.
4. **History** — Committed HTTP(S) navigations are stored globally and queried for autocomplete.
5. **Hardening** — Annotation, zoom, hide/dispose, workspace switching, preload typings, and tests are all in scope.

## Phase Overview

| Phase | Description |
|-------|-------------|
| 0 | Types, store migration, tab actions, and invariants |
| 1 | IPC surface compatibility bridge with registered handlers and preload/types |
| 2 | Main multi-`WebContentsView` architecture, annotation, zoom, lifecycle safety |
| 3 | Tab dropdown UI and `BrowserPanel` refactor |
| 4 | Global history service and IPC |
| 5 | URL autocomplete UI |
| 6 | Integration hardening, compatibility cleanup, and full validation |

## Important Execution Rules

- Every phase must be able to pass validation independently.
- Do not add channels to `ALL_IPC_CHANNELS` before their handlers/listeners exist.
- Keep existing workspace-scoped browser APIs compatible until all renderer callers are migrated; compatibility wrappers are allowed as bounded phase bridges.
- User/browser navigation remains HTTP(S)-only.
- New tabs open to `https://github.com`; do not introduce an `about:blank` special case in this sprint.
- Phase 6 must remove unused compatibility wrappers or document retained wrappers as supported API.
- Renderer generates tab IDs; main must preserve those IDs.
- Browser hide/dispose must not leave stale `WebContentsView` instances visible.

## Files Involved

| File | Change |
|------|--------|
| `src/renderer/store/workspaceTypes.ts` | Add `BrowserTab`, update `BrowserPaneState` |
| `src/renderer/store/workspaceStoreHelpers.ts` | Browser pane/tab migration and invariant helpers |
| `src/renderer/store/workspaceStore.ts` | Tab actions and `browserUrl` mirror behavior |
| `src/renderer/store/workspaceStoreTypes.ts` | Tab action signatures |
| `src/renderer/store/INVARIANTS.md` | Browser tab contracts |
| `src/renderer/components/WorkspaceScope.tsx` | Active workspace fallback snapshot compatibility |
| `src/renderer/components/DynamicPaneLayout.tsx` | BrowserPanel prop migration |
| `src/renderer/components/BrowserPanel.tsx` | Tab dropdown and autocomplete UI |
| `src/renderer/components/BrowserPanel.css` | Tab/autocomplete styling |
| `src/renderer/App.tsx` | URL update event payload with `tabId` |
| `src/renderer/electron.d.ts` | New preload API types |
| `src/main/main.ts` | Nested browser view maps and active tab/bounds maps |
| `src/main/ipc/browserIpc.ts` | Tabbed browser IPC and history IPC |
| `src/main/ipc/windowIpc.ts` | App zoom over nested tab views |
| `src/main/annotation/annotationIpc.ts` | Active tab view lookup / safe annotation behavior |
| `src/main/annotation/annotationController.ts` | Nested browser view lookup support |
| `src/main/preload.ts` | Tab/history preload APIs |
| `src/main/browserHistory.ts` | New history service |
| `src/shared/ipcChannels.ts` | Add channels only with handlers |
| `tests/setup/electron.ts` | New API mocks |
| `tests/setup/fixtures.ts` | Valid browser tab fixtures |

## Validation

Final phase must run:

```bash
npm run validate
```

Individual implementation phases should run targeted tests plus lint/typecheck as appropriate for touched areas.
